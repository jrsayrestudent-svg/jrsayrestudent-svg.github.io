const VIEWS = ["login", "register", "home", "gate", "staff"];
const $ = id => document.getElementById(id);
let user = null, staffIn = false, menu = [], cart = {}, my = null, serving = 0;
let soldOut = [];
let lastServing = null, readyNum = null, lastRepeat = null; // for student voice announcements

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) }

const pic = i => i.image_v ? `<img class="pic" src="api.php?action=item_image&id=${i.id}&v=${i.image_v}" alt="" loading="lazy">` : `<div class="pic ph" aria-hidden="true">${esc(i.name.charAt(0).toUpperCase())}</div>`;
// shrink a chosen photo in the browser so uploads stay small
function readPhoto(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onerror = () => rej();
    fr.onload = () => {
      const im = new Image(); im.onerror = () => rej();
      im.onload = () => {
        const k = Math.min(1, 480 / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.8));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------- talk to the server (api.php + MySQL) ---------- */
async function api(action, data) {
  try {
    const r = await fetch("api.php?action=" + action, {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "same-origin"
    });
    const j = await r.json().catch(() => ({ error: "The server sent an unexpected reply." }));
    if (!r.ok && !j.error) j.error = "Server error. Please try again.";
    return j;
  } catch (e) { return { error: "Cannot reach the server. Check your connection." } }
}

/* ---------- navigation ---------- */
function show(view) {
  VIEWS.forEach(v => $(v).classList.toggle("hide", v !== view));
  $("app").classList.toggle("wide", view === "staff");
  $("menu").classList.add("hide"); $("burger").setAttribute("aria-expanded", "false");
  renderMenu();
  if (view === "home") { renderList(); pollHome() }
  if (view === "staff") { pollStaff(); loadStaffMenu() }
}
function renderMenu() {
  $("menu").innerHTML = staffIn || user
    ? '<button data-act="logout">Log out</button>'
    : '<button data-go="login">Log in</button><button data-go="register">Register</button><button data-go="gate">Staff login</button>';
}
$("burger").onclick = () => { const m = $("menu"); const closed = m.classList.toggle("hide"); $("burger").setAttribute("aria-expanded", String(!closed)) };
document.addEventListener("click", async e => {
  const go = e.target.closest("[data-go]"); if (go) show(go.dataset.go);
  if (e.target.dataset.act === "logout") {
    await api(staffIn ? "staff_logout" : "logout", {});
    staffIn = false; user = null; cart = {}; my = null; lastServing = null; readyNum = null; lastRepeat = null;
    show("login");
  }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset.go) show(e.target.dataset.go) });

/* ---------- STUDENT: register and log in ---------- */
$("regBtn").onclick = async () => {
  $("rerr").textContent = "";
  const r = await api("register", { name: $("rn").value, email: $("re").value, password: $("rp").value });
  if (r.error) return $("rerr").textContent = r.error;
  user = r.user; show("home");
};
$("loginBtn").onclick = async () => {
  $("lerr").textContent = "";
  const r = await api("login", { email: $("le").value, password: $("lp").value });
  if (r.error) return $("lerr").textContent = r.error;
  user = r.user; show("home");
};
["le", "lp"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") $("loginBtn").click() }));

/* ---------- STUDENT: homepage, cart, place order ---------- */
function renderList() {
  if (!user) return;
  $("hello").textContent = "Hi, " + user.name.split(" ")[0] + ". What would you like?";
  $("availCnt").textContent = menu.length ? "(" + menu.length + ")" : "";
  $("menuList").innerHTML = menu.length ? menu.map(i => `<div class="card item">${pic(i)}<div class="n">${esc(i.name)}</div><div class="p">P${i.price}</div>
    <div class="qty">${cart[i.id] ? `<button class="minus" data-q="-${i.id}" aria-label="Remove one ${esc(i.name)}">&minus;</button><span>${cart[i.id]}</span>` : ""}
    <button data-q="${i.id}" aria-label="Add ${esc(i.name)}">+</button></div></div>`).join("")
    : '<p class="empty">Nothing is available right now.</p>';
  $("soldBox").classList.toggle("hide", !soldOut.length);
  $("soldList").innerHTML = soldOut.map(i => `<div class="card item off">${pic(i)}<div class="n">${esc(i.name)}</div><div class="p">P${i.price}</div><span class="badge so">Sold out</span></div>`).join("");
  renderBoard();
}
function renderBoard() {
  const total = menu.reduce((s, i) => s + (cart[i.id] || 0) * i.price, 0);
  $("total").textContent = "P" + total;
  $("orderBtn").disabled = !total || !!my;
  $("orderBtn").textContent = my ? "Order placed" : "Place order";
  $("myNum").textContent = my ? "#" + my.number : "--";
  $("serving").textContent = serving ? "#" + serving : "--";
  if (my) $("note").textContent = my.status === "ready" ? "Your order is ready. Go to the counter." : my.ahead + " order(s) ahead of you.";
}
async function pollHome() {
  if (!user) return;
  const r = await api("my_order");
  if (r.error) { if (r.error === "Please log in.") { user = null; show("login") } return }
  const had = !!my;
  my = r.order; serving = r.serving;
  const ready = my && my.status === "ready";
  const repeated = lastRepeat !== null && r.repeat !== lastRepeat; // staff pressed "Repeat announcement"
  if (ready && readyNum !== my.number) {
    readyNum = my.number;
    if (lastServing !== null && voiceOn) speak("Number " + my.number + ", your order is ready. Please go to the counter.");
  } else if (lastServing !== null && serving && serving !== lastServing) {
    announce(serving);
  } else if (repeated && serving && voiceOn) {
    if (ready && my.number === serving) speak("Number " + my.number + ", your order is ready. Please go to the counter.");
    else announce(serving);
  }
  lastServing = serving; lastRepeat = r.repeat;
  menu = r.items || menu; soldOut = r.soldout || soldOut;
  Object.keys(cart).forEach(id => { if (!menu.some(i => i.id == id)) delete cart[id] });
  if (had && !my) { cart = {}; $("note").textContent = "" }
  if (!my) $("note").textContent = $("note").textContent.startsWith("Server") ? $("note").textContent : "";
  renderList();
}
$("menuList").addEventListener("click", e => {
  const q = e.target.dataset.q; if (!q || my) return;
  const id = Math.abs(+q); cart[id] = Math.max(0, (cart[id] || 0) + (+q < 0 ? -1 : 1));
  renderList();
});
$("orderBtn").onclick = async () => {
  const items = Object.entries(cart).filter(([, n]) => n > 0).map(([id, qty]) => ({ id: +id, qty }));
  const r = await api("place_order", { items });
  if (r.error) return $("note").textContent = r.error;
  pollHome();
};

/* ---------- STAFF: login, orders, call next ---------- */
$("pinBtn").onclick = async () => {
  $("perr").textContent = "";
  const r = await api("staff_login", { pin: $("pin").value });
  if (r.error) return $("perr").textContent = r.error;
  staffIn = true; $("pin").value = ""; show("staff");
};
$("pin").addEventListener("keydown", e => { if (e.key === "Enter") $("pinBtn").click() });

async function pollStaff() {
  if (!staffIn) return;
  const r = await api("staff_orders");
  if (r.error) { if (r.error === "Staff login required.") { staffIn = false; show("gate") } return }
  $("sServing").textContent = r.serving ? "#" + r.serving : "--";
  $("waiting").textContent = r.orders.filter(o => o.status === "new").length;
  $("orders").innerHTML = r.orders.length ? r.orders.map(o => `
    <div class="order">
      <div class="no">#${o.number}</div>
      <div class="who">${esc(o.name)} <span class="badge ${o.status}">${o.status === "new" ? "Waiting" : "Ready"}</span></div>
      <div class="what">${o.items.map(i => `${i.qty} x ${esc(i.name)}`).join(", ")}</div>
      <div class="side"><b>P${o.total}</b>
        ${o.status === "new" ? `<button data-call="${o.number}">Call</button>` : `<button class="done" data-done="${o.number}">Mark done</button>`}
      </div>
    </div>`).join("") : '<p class="empty">No orders yet. New student orders appear here.</p>';
}
$("orders").addEventListener("click", async e => {
  if (e.target.dataset.call) { const n = +e.target.dataset.call; const r = await api("staff_call", { number: n }); if (!r.error) announce(n) }
  if (e.target.dataset.done) {
    const r = await api("staff_done", { number: +e.target.dataset.done });
    if (r.reset) {
      $("vmsg").textContent = "All orders served. The queue has reset, so the next order will be #1.";
      setTimeout(() => { $("vmsg").textContent = "" }, 8000);
    }
  }
  pollStaff();
});
$("nextBtn").onclick = async () => { const r = await api("staff_next", {}); if (r.number) announce(r.number); pollStaff() };
$("resetBtn").onclick = async () => {
  if (!confirm("Clear all orders and reset the queue?")) return;
  await api("staff_reset", {}); pollStaff();
};

/* ---------- STAFF: menu editor ---------- */
async function loadStaffMenu() {
  const r = await api("staff_menu"); if (r.error) return;
  const row = i => `<div class="card mrow ${i.available == 1 ? "" : "off"}">${pic(i)}<div class="n">${esc(i.name)}</div>
    <input type="number" min="1" value="${i.price}" data-mp="${i.id}" aria-label="Price of ${esc(i.name)}">
    <div class="btns"><button data-msave="${i.id}">Save price</button>
      <button class="alt2" data-mtoggle="${i.id}" data-av="${i.available == 1 ? 0 : 1}">${i.available == 1 ? "Mark sold out" : "Make available"}</button>
      <label class="fbtn">${i.image_v ? "Change photo" : "Add photo"}<input type="file" accept="image/*" hidden data-mphoto="${i.id}"></label>
      ${i.image_v ? `<button class="alt2" data-mnopic="${i.id}">Remove photo</button>` : ""}
      <button class="del" data-mdel="${i.id}">Delete</button></div></div>`;
  const on = r.items.filter(i => i.available == 1), off = r.items.filter(i => i.available != 1);
  $("mAvail").textContent = "(" + on.length + ")";
  $("mlist").innerHTML = on.length ? on.map(row).join("") : '<p class="empty">Nothing is available to sell. Add an item or make one available.</p>';
  $("mlistOff").innerHTML = off.map(row).join("");
  $("mOffBox").classList.toggle("hide", !off.length);
}
let newPhoto = null;
$("mfile").onchange = async () => {
  const f = $("mfile").files[0]; newPhoto = null; $("mfileName").textContent = "Add photo"; if (!f) return;
  try { newPhoto = await readPhoto(f); $("mfileName").textContent = "Photo ready" } catch (e) { $("merr").textContent = "That file is not a usable picture." }
};
$("mAdd").onclick = async () => {
  $("merr").textContent = "";
  const r = await api("staff_menu_add", { name: $("mname").value, price: $("mprice").value, image: newPhoto });
  if (r.error) return $("merr").textContent = r.error;
  $("mname").value = ""; $("mprice").value = ""; newPhoto = null; $("mfile").value = ""; $("mfileName").textContent = "Add photo"; loadStaffMenu();
};
$("mwrap").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0], id = e.target.dataset.mphoto; if (!f || !id) return;
  let img; try { img = await readPhoto(f) } catch (x) { return $("merr").textContent = "That file is not a usable picture." }
  const r = await api("staff_menu_update", { id: +id, image: img }); $("merr").textContent = r.error || ""; loadStaffMenu();
});
$("mwrap").addEventListener("click", async e => {
  const d = e.target.dataset; let r;
  if (d.msave) r = await api("staff_menu_update", { id: +d.msave, price: document.querySelector(`[data-mp="${d.msave}"]`).value });
  else if (d.mtoggle) r = await api("staff_menu_update", { id: +d.mtoggle, available: +d.av });
  else if (d.mnopic) r = await api("staff_menu_update", { id: +d.mnopic, image: null });
  else if (d.mdel) { if (!confirm("Delete this menu item?")) return; r = await api("staff_menu_delete", { id: +d.mdel }) }
  else return;
  $("merr").textContent = r && r.error ? r.error : "";
  loadStaffMenu();
});

document.querySelector(".tabs").addEventListener("click", e => {
  const t = e.target.dataset.tab; if (!t) return;
  ["paneOrders", "paneMenu", "paneHistory"].forEach(id => $(id).classList.toggle("hide", id !== t));
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  if (t === "paneMenu") loadStaffMenu();
  if (t === "paneHistory") loadHistory();
});

/* ---------- STAFF: history (what was sold, what was added) ---------- */
let hRows = [], hFilter = "all";
const KIND = { sold: "Sold", added: "Added", price: "Price", available: "Available", soldout: "Sold out", photo: "Photo", removed: "Removed" };
async function loadHistory() {
  const r = await api("staff_history"); if (r.error) return;
  hRows = r.rows;
  $("hsum").innerHTML = `<div><b>${r.sold_qty}</b><span>items sold</span></div><div><b>P${r.sold_amount}</b><span>total sales</span></div>`;
  renderHistory();
}
function renderHistory() {
  const rows = hRows.filter(x => hFilter === "all" || (hFilter === "sold" ? x.kind === "sold" : hFilter === "added" ? x.kind === "added" : x.kind !== "sold" && x.kind !== "added"));
  $("hlist").innerHTML = rows.length ? rows.map(x => `<div class="hrow"><span class="badge k-${x.kind}">${KIND[x.kind] || esc(x.kind)}</span>
    <div class="hmain"><b>${x.kind === "sold" ? x.qty + " x " : ""}${esc(x.item_name)}</b><small>${esc(x.detail || "")}</small></div>
    <div class="hside">${x.amount != null ? "P" + x.amount : ""}<small>${new Date(x.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div></div>`).join("")
    : '<p class="empty">Nothing here yet.</p>';
}
$("hfilter").addEventListener("click", e => {
  const f = e.target.dataset.f; if (!f) return; hFilter = f;
  document.querySelectorAll("#hfilter button").forEach(b => b.classList.toggle("on", b.dataset.f === f));
  renderHistory();
});
$("hClear").onclick = async () => { if (!confirm("Clear the whole history?")) return; await api("staff_history_clear", {}); loadHistory() };

/* ---------- VOICE: "Now serving number 8" (staff and students) ---------- */
let voiceOn = true;
try { voiceOn = localStorage.getItem("qb_voice") !== "0" } catch (e) {}
$("voiceOn").checked = voiceOn; $("svoice").checked = voiceOn;
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel(); speechSynthesis.resume();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9; u.pitch = 1; u.volume = 1;
  // a short pause after cancel() stops Chrome from dropping the new message
  setTimeout(() => speechSynthesis.speak(u), 150);
}
function announce(n, force) {
  if ((!voiceOn && !force) || !n) return;
  speak("Now serving number " + n);
}
function setVoice(on) {
  voiceOn = on; $("voiceOn").checked = on; $("svoice").checked = on;
  try { localStorage.setItem("qb_voice", on ? "1" : "0") } catch (e) {}
  if (!on && "speechSynthesis" in window) speechSynthesis.cancel();
}
$("voiceOn").onchange = () => setVoice($("voiceOn").checked);
$("svoice").onchange = () => setVoice($("svoice").checked);
// phones only allow speech after a tap, so unlock it silently on the first tap
document.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u);
}, { once: true });
$("repeatBtn").onclick = async () => {
  $("vmsg").textContent = "";
  if (!("speechSynthesis" in window)) return $("vmsg").textContent = "This browser can't play voice. Try Chrome or Edge.";
  const r = await api("staff_orders");
  if (r.error) return $("vmsg").textContent = r.error;
  if (!r.serving) return $("vmsg").textContent = "No number has been called yet. Press Call next first.";
  announce(r.serving, true);
  api("staff_repeat", {}); // also replays it on every student's phone
  $("vmsg").textContent = "Announcing number " + r.serving + "...";
  setTimeout(() => { $("vmsg").textContent = "" }, 3000);
};

/* ---------- keep both sides live ---------- */
setInterval(() => {
  if (!$("home").classList.contains("hide")) pollHome();
  if (!$("staff").classList.contains("hide")) { pollStaff(); if (!$("paneHistory").classList.contains("hide")) loadHistory() }
}, 3000);

/* ---------- start ---------- */
(async () => {
  const m = await api("me");
  user = m.user || null; staffIn = !!m.staff;
  show(staffIn ? "staff" : (user ? "home" : "login"));
})();

