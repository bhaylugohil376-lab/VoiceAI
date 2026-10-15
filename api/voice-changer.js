
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError, sendSuccess } from "./_lib/response.js";

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_OUTPUT_SIZE = 30 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
  "audio/mp4", "audio/webm", "audio/ogg", "audio/flac"
]);

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function textField(fields, key) {
  const value = fields[key];
  return (Array.isArray(value) ? value[0] : value || "").trim();
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

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, fields, files) => {
        if (error) reject(error);
        else resolve([fields, files]);
      });
    });

    uploadedFile = Array.isArray(files.audio) ? files.audio[0] : files.audio;

    if (!uploadedFile) {
      return sendError(res, 400, "Upload an audio file in the audio field.");
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const voiceId = textField(fields, "voice_id");

    if (!/^[A-Za-z0-9_-]{5,100}$/.test(voiceId)) {
      return sendError(res, 400, "Select a valid target voice.");
    }

    const providerUrl = process.env.VOICE_CHANGER_API_URL;
    const providerKey = process.env.VOICE_CHANGER_API_KEY;

    if (!providerUrl || !isHttpsUrl(providerUrl) || !providerKey) {
      return sendError(res, 503, "Configure a valid HTTPS voice conversion provider.");
    }

    const audioBuffer = await readFile(uploadedFile.filepath);

    if (!audioBuffer.length) {
      return sendError(res, 400, "The uploaded audio is empty.");
    }

    const usage = await checkAndUseAI(user, "voice_changer");
    if (!usage.allowed) {
      return sendError(res, usage.status || 429, usage.error || "Usage limit reached.");
    }

    const providerForm = new FormData();
    providerForm.append(
      "audio",
      new Blob([audioBuffer], { type: uploadedFile.mimetype }),
      uploadedFile.originalFilename || "audio-upload"
    );
    providerForm.append("voice_id", voiceId);

    let response;

    try {
      response = await fetch(providerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerKey}`,
          "x-api-key": providerKey,
          Accept: "audio/*, application/json"
        },
        body: providerForm,
        signal: AbortSignal.timeout(120000)
      });
    } catch (error) {
      return sendError(
        res,
        error?.name === "TimeoutError" ? 504 : 502,
        "Could not reach the voice conversion provider."
      );
    }

    if (!response.ok) {
      console.error("Voice provider returned status:", response.status);

      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "Voice provider quota exceeded. Try again later."
          : "Voice provider could not convert the audio."
      );
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    let output;

    if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
      const outputBuffer = Buffer.from(await response.arrayBuffer());

      if (!outputBuffer.length || outputBuffer.length > MAX_OUTPUT_SIZE) {
        return sendError(res, 502, "Provider returned empty or oversized audio.");
      }

      output = {
        audio_base64: outputBuffer.toString("base64"),
        mime_type: contentType.startsWith("audio/") ? contentType : "audio/mpeg"
      };
    } else {
      const result = await response.json().catch(() => null);
      const encoded = result?.audio_base64 || result?.audio;

      if (typeof encoded !== "string" || !encoded.trim()) {
        return sendError(
          res,
          502,
          "Provider response must contain audio data or return an audio file."
        );
      }

      const clean = encoded.replace(/^data:audio\/[^;]+;base64,/, "").replace(/\s/g, "");

      if (
        clean.length > Math.ceil(MAX_OUTPUT_SIZE / 3) * 4 + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)
      ) {
        return sendError(res, 502, "Provider returned invalid audio data.");
      }

      const outputBuffer = Buffer.from(clean, "base64");

      if (!outputBuffer.length || outputBuffer.length > MAX_OUTPUT_SIZE) {
        return sendError(res, 502, "Provider returned empty or oversized audio.");
      }

      output = {
        audio_base64: outputBuffer.toString("base64"),
        mime_type: result.mime_type || "audio/mpeg"
      };
    }

    return sendSuccess(res, {
      ...output,
      file_name: "voiceai-converted-audio",
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Voice Changer error:", error?.message || error);

    if (error?.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Audio file must be 20 MB or smaller.");
    }

    return sendError(res, 500, "Voice conversion request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
