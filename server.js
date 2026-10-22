// Zero-dependency Node server (Node 18+).
// GPT-4o handles conversation and prompt writing; the image service renders the visual.
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  });
} catch {}

const {
  AZURE_ENDPOINT = "https://image-chatbot.services.ai.azure.com/openai/v1/responses",
  AZURE_API_KEY,
  AZURE_MODEL = "gpt-4o",
  IMAGE_URL_TEMPLATE = "https://image.pollinations.ai/prompt/{prompt}?width={width}&height={height}&nologo=true&seed={seed}",
  PORT = 3000,
} = process.env;

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const DIMENSIONS = { "1:1": [1024, 1024], "16:9": [1280, 720], "9:16": [720, 1280] };
const INSTRUCTIONS = `You are a friendly assistant inside an image-generating chatbot.
Reply ONLY with a JSON object of this exact shape:
{"reply":"<your message to the user>","image_prompt":"<prompt or null>"}
Rules:
- If the user asks for a picture, image, drawing, illustration, logo, wallpaper, poster or any visual, set image_prompt to a detailed English prompt with subject, style, colors, lighting and composition, and make reply a short friendly line.
- If the user asks to change or refine the previous image, write a new complete image_prompt that includes the earlier idea plus the change.
- Otherwise set image_prompt to null and answer normally in reply. Reply in the user's language.
- Always return valid JSON and no markdown fences.`;

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function safeRatio(value) { return DIMENSIONS[value] ? value : "1:1"; }
function makeImageUrl(prompt, ratio) {
  const [width, height] = DIMENSIONS[safeRatio(ratio)];
  return IMAGE_URL_TEMPLATE.replace("{prompt}", encodeURIComponent(prompt)).replace("{seed}", String(Math.floor(Math.random() * 1e9))).replace("{width}", String(width)).replace("{height}", String(height)).replace(/([?&])width=\d+/i, `$1width=${width}`).replace(/([?&])height=\d+/i, `$1height=${height}`);
}
async function makeImage(prompt, ratio) {
  const response = await fetch(makeImageUrl(prompt, ratio), { signal: AbortSignal.timeout(120000) });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.startsWith("image/")) throw new Error(`Image service returned ${response.status} ${type}`);
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

async function handleChat(req, res) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, { error: "Message is too large." }); }
  let body;
  try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON" }); }
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return send(res, 400, { error: "Please enter a message." });
  if (!AZURE_API_KEY) return send(res, 500, { error: "AZURE_API_KEY is missing in .env" });

  const style = typeof body.style === "string" ? body.style.slice(0, 40) : "Photorealistic";
  const aspectRatio = safeRatio(body.aspect_ratio);
  const payload = {
    model: AZURE_MODEL,
    input: `Please respond in JSON format following the required output shape.\nSelected visual style: ${style}\nSelected aspect ratio: ${aspectRatio}\n\nUser request: ${input}`,
    instructions: INSTRUCTIONS,
    text: { format: { type: "json_object" } },
  };
  if (body.previous_response_id) payload.previous_response_id = body.previous_response_id;

  try {
    const upstream = await fetch(AZURE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_API_KEY }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
    const data = await upstream.json();
    if (!upstream.ok) return send(res, upstream.status, { error: data?.error?.message || JSON.stringify(data) });
    let output = data.output_text || "";
    if (!output) for (const item of data.output || []) for (const content of item.content || []) if (content.type === "output_text") output += content.text;

    let reply = output || "I’m ready to help.", imagePrompt = null;
    try {
      const parsed = JSON.parse(output.replace(/^```json\s*|\s*```$/g, ""));
      reply = parsed.reply || "Here is your result.";
      imagePrompt = parsed.image_prompt && parsed.image_prompt !== "null" ? String(parsed.image_prompt) : null;
    } catch {}

    const images = [];
    if (imagePrompt) {
      const styledPrompt = `${imagePrompt}, ${style} style, ${aspectRatio} aspect ratio`;
      try { images.push(await makeImage(styledPrompt, aspectRatio)); }
      catch (error) { reply += `\n\nI wrote the image prompt, but the image service failed: ${error.message}`; }
    }
    send(res, 200, { id: data.id, text: reply, images, image_prompt: imagePrompt, style, aspect_ratio: aspectRatio });
  } catch (error) { send(res, 502, { error: `Could not reach Azure: ${error.message}` }); }
}

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  const file = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\/+/, "");
  if (!["index.html", "style.css", "script.js"].includes(file)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  fs.readFile(path.join(__dirname, file), (error, buffer) => error ? send(res, 404, "Not found", "text/plain; charset=utf-8") : send(res, 200, buffer, MIME[path.extname(file)]));
}).listen(PORT, () => console.log(`Imagine running at http://localhost:${PORT}`));
