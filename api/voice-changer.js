
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  sendError,
  sendSuccess
} from "./_lib/response.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_OUTPUT_SIZE = 30 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/flac"
]);

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploadedFile;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const form = formidable({
      maxFiles: 1,
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      multiples: false
    });

    const [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, fields, files) => {
        if (error) reject(error);
        else resolve([fields, files]);
      });
    });

    uploadedFile = Array.isArray(files.audio)
      ? files.audio[0]
      : files.audio;

    if (!uploadedFile) {
      return sendError(
        res,
        400,
        "Upload an audio file in the audio field."
      );
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const voiceValue = Array.isArray(files.voice_id)
      ? files.voice_id[0]
      : undefined;

    // Formidable returns text inputs in fields, not files.
    // Parse them from the request's fields below instead.
  } catch (error) {
    if (error?.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Audio file must be 20 MB or smaller.");
    }

    console.error("Voice Changer error:", error?.message || error);
    return sendError(res, 500, "Voice conversion request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
