const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const lightbox = document.getElementById("lightbox");
const sidebar = document.getElementById("sidebar");
const scrim = document.getElementById("scrim");
const galleryList = document.getElementById("galleryList");
const galleryCount = document.getElementById("galleryCount");
const historyCount = document.getElementById("historyCount");

const STORAGE_KEY = "imagine-session-gallery-v2";
let previousResponseId = null;
let busy = false;
let selectedStyle = "Photorealistic";
let selectedRatio = "1:1";
let gallery = readGallery();

function readGallery() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveGallery() { localStorage.setItem(STORAGE_KEY, JSON.stringify(gallery.slice(0, 30))); renderGallery(); }
function scrollDown() { requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; }); }
function setComposerHeight() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 145)}px`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }

function renderGallery() {
  galleryCount.textContent = gallery.length;
  historyCount.textContent = gallery.length;
  if (!gallery.length) {
    galleryList.innerHTML = '<div class="empty-gallery"><span>◌</span><p>Your generated images<br />will appear here.</p></div>';
    return;
  }
  galleryList.innerHTML = gallery.map((item, index) => `<button class="gallery-item" type="button" data-index="${index}" title="Open saved image"><img src="${item.src}" alt="${escapeHtml(item.prompt)}" /><p>${escapeHtml(item.prompt)}</p></button>`).join("");
  galleryList.querySelectorAll(".gallery-item").forEach((item) => item.addEventListener("click", () => openLightbox(gallery[Number(item.dataset.index)].src)));
}

function addMessage(role, text = "") {
  const msg = document.createElement("article");
  msg.className = `msg ${role}`;
  msg.innerHTML = `<div class="avatar">${role === "user" ? "●" : "✦"}</div><div class="message-content"><div class="bubble"></div></div>`;
  const bubble = msg.querySelector(".bubble");
  if (text) bubble.textContent = text;
  chat.appendChild(msg);
  scrollDown();
  return { msg, bubble, holder: msg.querySelector(".message-content") };
}

function typeText(element, text) {
  return new Promise((resolve) => {
    element.textContent = "";
    let cursor = 0;
    const step = () => {
      cursor += Math.max(1, Math.ceil((text.length - cursor) / 13));
      element.textContent = text.slice(0, cursor);
      scrollDown();
      if (cursor < text.length) setTimeout(step, 18); else resolve();
    };
    step();
  });
}

function addLoading(holder, wantsImage) {
  const loading = document.createElement("div");
  loading.className = "generation-loading";
  loading.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>${wantsImage ? '<div class="paint"></div>' : ""}`;
  holder.appendChild(loading);
  scrollDown();
  return loading;
}

function openLightbox(src) { lightbox.querySelector("img").src = src; lightbox.hidden = false; document.body.style.overflow = "hidden"; }
function closeLightbox() { lightbox.hidden = true; document.body.style.overflow = ""; }
function toggleSidebar(open) { sidebar.classList.toggle("open", open); scrim.hidden = !open; }

function addImage(holder, b64, prompt) {
  const src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  const card = document.createElement("div");
  card.className = "img-card";
  card.innerHTML = `<img src="${src}" alt="Generated image for ${escapeHtml(prompt)}" /><div class="image-meta"><small>${escapeHtml(selectedStyle)} · ${selectedRatio}</small><div class="image-actions"><button type="button" data-action="copy">Copy prompt</button><button type="button" data-action="download">Download</button><button type="button" data-action="remix">Remix</button></div></div>`;
  const image = card.querySelector("img");
  image.addEventListener("click", () => openLightbox(src));
  card.querySelector('[data-action="copy"]').addEventListener("click", async (event) => {
    try { await navigator.clipboard.writeText(prompt); event.currentTarget.textContent = "Copied"; setTimeout(() => event.currentTarget.textContent = "Copy prompt", 1400); } catch { event.currentTarget.textContent = "Select prompt"; }
  });
  card.querySelector('[data-action="download"]').addEventListener("click", () => { const link = document.createElement("a"); link.href = src; link.download = `imagine-${Date.now()}.png`; link.click(); });
  card.querySelector('[data-action="remix"]').addEventListener("click", () => { input.value = `Remix this image: ${prompt}`; setComposerHeight(); input.focus(); });
  holder.appendChild(card);
  gallery.unshift({ src, prompt, style: selectedStyle, ratio: selectedRatio, createdAt: Date.now() });
  saveGallery();
  scrollDown();
}

async function send(text) {
  const prompt = text.trim();
  if (busy || !prompt) return;
  busy = true; sendBtn.disabled = true;
  document.getElementById("welcome")?.remove();
  addMessage("user", prompt);
  input.value = ""; setComposerHeight();
  const wantsImage = /\b(image|picture|photo|draw|paint|illustrat|generate|create|logo|poster|wallpaper|art|visual|scene|portrait|landscape)\b/i.test(prompt);
  const bot = addMessage("bot");
  const loading = addLoading(bot.holder, wantsImage);
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: prompt, style: selectedStyle, aspect_ratio: selectedRatio, previous_response_id: previousResponseId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    previousResponseId = data.id || previousResponseId;
    loading.remove();
    const reply = data.text || (data.images?.length ? "Here is your creation." : "I’m ready for your next idea.");
    await typeText(bot.bubble, reply);
    (data.images || []).forEach((image) => addImage(bot.holder, image, data.image_prompt || prompt));
  } catch (error) {
    loading.remove(); bot.msg.classList.add("error"); bot.bubble.textContent = `Couldn’t complete that request. ${error.message}`;
  } finally { busy = false; sendBtn.disabled = false; input.focus(); scrollDown(); }
}

form.addEventListener("submit", (event) => { event.preventDefault(); send(input.value); });
input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
input.addEventListener("input", setComposerHeight);
document.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => send(chip.textContent.replace(/^[^A-Za-z]+/, ""))));
document.querySelectorAll(".style-chip").forEach((chip) => chip.addEventListener("click", () => { document.querySelectorAll(".style-chip").forEach((item) => item.classList.remove("active")); chip.classList.add("active"); selectedStyle = chip.dataset.style; }));
document.querySelectorAll(".ratio-chip").forEach((chip) => chip.addEventListener("click", () => { document.querySelectorAll(".ratio-chip").forEach((item) => item.classList.remove("active")); chip.classList.add("active"); selectedRatio = chip.dataset.ratio; }));
document.getElementById("historyBtn").addEventListener("click", () => toggleSidebar(true));
document.getElementById("closeSidebar").addEventListener("click", () => toggleSidebar(false));
scrim.addEventListener("click", () => toggleSidebar(false));
document.getElementById("clearGallery").addEventListener("click", () => { gallery = []; saveGallery(); });
document.getElementById("newChat").addEventListener("click", () => location.reload());
lightbox.addEventListener("click", (event) => { if (event.target === lightbox || event.target === lightbox.querySelector("p")) closeLightbox(); });
document.getElementById("closeLightbox").addEventListener("click", closeLightbox);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeLightbox(); toggleSidebar(false); } });
renderGallery();
