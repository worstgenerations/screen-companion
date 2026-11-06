// Melo side panel. Talks to the existing Melo backend; no AI keys live here.
const API = "https://live-screen-coach.lovable.app";
const SB_URL = "https://wotcppwwvieobzqhbagu.supabase.co";
const SB_KEY = "sb_publishable_5KmXbUVEMa1UwE_5-PBmbw_TwqngBMc"; // public key, safe in clients

const $ = (id) => document.getElementById(id);
let session = null;
let history = [];
let ctrl = null;
let audioQueue = [];
let playing = false;
let speakToken = 0;
let rec = null;
let micOn = false;

function setMode(m) {
  $("orb").dataset.mode = m;
  $("status").textContent = { idle: "Ready", thinking: "Thinking…", speaking: "Speaking", listening: "Listening" }[m];
  $("stop").classList.toggle("hidden", m !== "speaking");
}

// ---------- auth (same account as the website) ----------
async function saveSession(s) { session = s; await chrome.storage.local.set({ session: s }); }
async function loadSession() {
  const { session: s } = await chrome.storage.local.get("session");
  if (!s) return null;
  if (s.expires_at * 1000 > Date.now() + 60000) return s;
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) return null;
  const n = await r.json();
  await saveSession(n);
  return n;
}
function showApp(on) {
  $("login").classList.toggle("hidden", on);
  $("app").classList.toggle("hidden", !on);
  $("signout").classList.toggle("hidden", !on);
}
$("signin").onclick = async () => {
  $("loginErr").textContent = "";
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $("loginErr").textContent = j.error_description || j.msg || "Sign-in failed."; return; }
  await saveSession(j);
  showApp(true);
};
$("signout").onclick = async () => { await chrome.storage.local.remove("session"); session = null; showApp(false); };

// ---------- current tab screenshot (only when the user asks) ----------
async function captureTab() {
  if (!$("seeTab").checked) return undefined;
  try {
    const ok = await chrome.permissions.contains({ origins: ["<all_urls>"] }) ||
      await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!ok) return undefined;
    const url = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 60 });
    return url.split(",")[1];
  } catch { return undefined; } // e.g. chrome:// pages can't be captured
}

// ---------- voice out ----------
function haltVoice() { speakToken++; audioQueue = []; playing = false; document.querySelectorAll("audio").forEach((a) => a.pause()); speechSynthesis.cancel(); }
function fetchVoice(text) {
  return fetch(`${API}/api/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
    .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null);
}
function enqueue(text) {
  if (!text.trim()) return;
  audioQueue.push({ text, audio: fetchVoice(text) });
  setMode("speaking");
  if (!playing) playNext();
}
async function playNext() {
  const tok = speakToken;
  const item = audioQueue.shift();
  if (!item) { playing = false; setMode(micOn ? "listening" : "idle"); return; }
  playing = true;
  const url = await item.audio;
  if (tok !== speakToken) return;
  const done = () => { if (tok === speakToken) playNext(); };
  if (url) { const a = new Audio(url); a.onended = done; a.onerror = done; document.body.appendChild(a); a.play().catch(done); return; }
  const u = new SpeechSynthesisUtterance(item.text); u.onend = done; u.onerror = done; speechSynthesis.speak(u);
}
$("stop").onclick = () => { haltVoice(); setMode("idle"); };

// ---------- ask ----------
function addMsg(role, text) { const d = document.createElement("div"); d.className = `msg ${role}`; d.textContent = text; $("log").appendChild(d); d.scrollIntoView({ block: "end" }); return d; }

async function ask(text) {
  text = text.trim(); if (!text) return;
  ctrl?.abort(); haltVoice();
  $("err").textContent = "";
  session = await loadSession();
  if (!session) { showApp(false); return; }
  addMsg("user", text);
  setMode("thinking");
  const image = await captureTab();
  ctrl = new AbortController();
  try {
    const res = await fetch(`${API}/api/melo-stream`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        text: image ? `Here is the browser tab I'm looking at. I said: "${text}". Answer using what you see — never reply SKIP.` : text,
        ...(image ? { image } : {}), source: "text", userText: text, detail: "fast",
        history: history.slice(-6),
      }),
    });
    if (!res.ok || !res.body) { $("err").textContent = res.status === 401 ? "Please sign in again." : "Couldn't reach Melo. Try again."; setMode("idle"); return; }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let full = "", spoken = 0, el = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) full += dec.decode(value, { stream: true });
      if (full.trim()) { el ??= addMsg("assistant", ""); el.textContent = full; }
      const rest = full.slice(spoken); const re = /[^.!?]+[.!?]+["')\]]*\s+/g; let m, used = 0;
      while ((m = re.exec(rest))) used = m.index + m[0].length;
      if (used) { enqueue(rest.slice(0, used)); spoken += used; }
      if (done) break;
    }
    enqueue(full.slice(spoken));
    history.push({ role: "user", content: text }, { role: "assistant", content: full.slice(0, 4000) });
    if (!playing) setMode(micOn ? "listening" : "idle");
  } catch (e) { if (e.name !== "AbortError") { $("err").textContent = "Something went wrong."; setMode("idle"); } }
}
$("send").onclick = () => { const t = $("input").value; $("input").value = ""; ask(t); };
$("input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("send").click(); } };
document.querySelectorAll(".quick button").forEach((b) => (b.onclick = () => ask(b.dataset.q)));

// ---------- voice in (hands-free, interruptible) ----------
$("mic").onclick = async () => {
  if (micOn) { micOn = false; rec?.stop(); $("mic").textContent = "🎙 Talk"; setMode("idle"); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $("err").textContent = "Voice input isn't available in this browser."; return; }
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); }
  catch { chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") }); $("err").textContent = "Allow the microphone in the tab that opened, then press Talk again."; return; }
  rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || "en-US";
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]; const t = r[0].transcript.trim();
      if (!r.isFinal) { if (t.split(" ").length >= 2 && playing) { haltVoice(); setMode("listening"); } continue; }
      if (t && !/^(uh+|um+|hmm+|okay|ok|yeah)[.!? ]*$/i.test(t)) ask(t);
    }
  };
  rec.onend = () => { if (micOn) try { rec.start(); } catch {} };
  micOn = true; rec.start(); $("mic").textContent = "🔇 Mute"; setMode("listening");
};

loadSession().then((s) => { session = s; showApp(!!s); });
