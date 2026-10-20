import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4",
  "audio/m4a", "audio/webm", "audio/ogg", "video/mp4", "video/webm",
  "video/quicktime"
]);
const ELEVENLABS_DUBBING_URL = "https://api.elevenlabs.io/v1/dubbing";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploadedFile;
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "Dubbing is not configured. Add ELEVENLABS_API_KEY to the Vercel project environment.");
    }

    const form = formidable({
      maxFiles: 1,
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      multiples: false
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, fields, files) => {
        if (error) reject(error);
        else resolve([fields, files]);
      });
    });

    uploadedFile = Array.isArray(files.media) ? files.media[0] : files.media;
    if (!uploadedFile) return sendError(res, 400, "Upload a media file using the 'media' field.");
    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio or video format.");
    }

    const fieldValue = (name) => Array.isArray(fields[name]) ? fields[name][0] : fields[name];
    const targetLanguage = String(fieldValue("target_language") || "").trim().toLowerCase();
    const sourceLanguage = String(fieldValue("sourceLanguage") || "").trim().toLowerCase();

    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(targetLanguage)) {
      return sendError(res, 400, "Select a valid target language.");
    }

    const usage = await checkAndUseAI(user, "dubbing");
    if (!usage.allowed) {
      return sendError(res, usage.status || 429, usage.error || "Dubbing usage limit reached.");
    }

    const fileBuffer = await readFile(uploadedFile.filepath);
    if (!fileBuffer.length) return sendError(res, 400, "The uploaded file is empty.");

    const upload = new FormData();
    upload.append("file", new Blob([fileBuffer], { type: uploadedFile.mimetype || "application/octet-stream" }),
      uploadedFile.originalFilename || "voiceai-media");
    upload.append("target_lang", targetLanguage);
    upload.append("name", "VoiceAI dubbing");
    if (sourceLanguage && sourceLanguage !== "auto" && /^[a-z]{2,3}$/.test(sourceLanguage)) {
      upload.append("source_lang", sourceLanguage);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    let createResponse;
    try {
      createResponse = await fetch(ELEVENLABS_DUBBING_URL, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: upload,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!createResponse.ok) {
      const providerMessage = await createResponse.text().catch(() => "");
      console.error("ElevenLabs dubbing create failed:", createResponse.status, providerMessage.slice(0, 500));
      return sendError(res, 502, "ElevenLabs could not start dubbing. Check API key permissions, supported language, file format, and account credits.");
    }

    const created = await createResponse.json();
    const dubbingId = typeof created.dubbing_id === "string" ? created.dubbing_id : "";
    if (!dubbingId) return sendError(res, 502, "ElevenLabs did not return a dubbing job ID.");

    // Legacy dubbing is asynchronous. Poll briefly so the existing UI can receive
    // a playable result without exposing provider credentials to the browser.
    const statusController = new AbortController();
    const statusTimeout = setTimeout(() => statusController.abort(), 18000);
    let finalStatus = null;
    try {
      for (let attempt = 0; attempt < 7; attempt += 1) {
        if (attempt > 0) await wait(1800);
        const statusResponse = await fetch(
          `${ELEVENLABS_DUBBING_URL}/${encodeURIComponent(dubbingId)}`,
          { headers: { "xi-api-key": apiKey }, signal: statusController.signal }
        );
        if (!statusResponse.ok) continue;
        finalStatus = await statusResponse.json();
        const state = String(finalStatus.status || "").toLowerCase();
        if (state === "dubbed" || state === "completed") break;
        if (state === "failed") {
          return sendError(res, 502, "ElevenLabs reported that this dubbing job failed.");
        }
      }
    } finally {
      clearTimeout(statusTimeout);
    }

    const state = String(finalStatus?.status || "").toLowerCase();
    if (state !== "dubbed" && state !== "completed") {
      return res.status(202).json({
        success: true,
        status: "processing",
        job_id: dubbingId,
        message: "Dubbing is still processing. Please try again in a little while."
      });
    }

    const audioResponse = await fetch(
      `${ELEVENLABS_DUBBING_URL}/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(targetLanguage)}`,
      { headers: { "xi-api-key": apiKey }, signal: statusController.signal }
    );
    if (!audioResponse.ok) {
      console.error("ElevenLabs dubbing audio fetch failed:", audioResponse.status);
      return sendError(res, 502, "Dubbing completed, but the output audio could not be retrieved.");
    }

    const mimeType = audioResponse.headers.get("content-type") || "audio/mpeg";
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    if (!audioBuffer.length) return sendError(res, 502, "ElevenLabs returned an empty dubbed file.");

    const base64 = audioBuffer.toString("base64");
    const isVideo = (uploadedFile.mimetype || "").startsWith("video/");
    return res.status(200).json({
      success: true,
      status: "completed",
      job_id: dubbingId,
      type: isVideo ? "video" : "audio",
      mediaType: isVideo ? "video" : "audio",
      mimeType,
      base64,
      outputUrl: `data:${mimeType};base64,${base64}`,
      remaining: usage.remaining
    });
  } catch (error) {
    if (error.code === "LIMIT_FILE_SIZE") return sendError(res, 413, "Media file must be 25 MB or smaller.");
    if (error.name === "AbortError") return sendError(res, 504, "ElevenLabs dubbing timed out. Try a shorter media file.");
    console.error("Dubbing API error:", error.message);
    return sendError(res, 500, "Dubbing request failed.");
  } finally {
    if (uploadedFile?.filepath) await unlink(uploadedFile.filepath).catch(() => {});
  }
}
