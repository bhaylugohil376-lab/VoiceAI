
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

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_OUTPUT_SIZE = 35 * 1024 * 1024;

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

const ALLOWED_MODES = new Set([
  "isolate_vocals",
  "remove_vocals",
  "reduce_noise"
]);

function getField(fields, name) {
  const value = fields[name];
  return (Array.isArray(value) ? value[0] : value || "").trim();
}

function validHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validBase64(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= Math.ceil(MAX_OUTPUT_SIZE / 3) * 4 + 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
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

    uploadedFile = Array.isArray(files.audio)
      ? files.audio[0]
      : files.audio;

    if (!uploadedFile) {
      return sendError(
        res,
        400,
        "Upload an audio file using the audio field."
      );
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const mode = getField(fields, "mode");

    if (!ALLOWED_MODES.has(mode)) {
      return sendError(
        res,
        400,
        "Choose isolate_vocals, remove_vocals, or reduce_noise."
      );
    }

    const providerUrl = process.env.VOICE_ISOLATOR_API_URL;
    const providerKey = process.env.VOICE_ISOLATOR_API_KEY;

    if (
      !providerUrl ||
      !validHttpsUrl(providerUrl) ||
      !providerKey
    ) {
      return sendError(
        res,
        503,
        "Configure a valid HTTPS Voice Isolator provider endpoint and API key."
      );
    }

    const audioBuffer = await readFile(uploadedFile.filepath);

    if (!audioBuffer.length) {
      return sendError(res, 400, "The uploaded audio is empty.");
    }

    const usage = await checkAndUseAI(user, "voice_isolator");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Voice Isolator usage limit reached."
      );
    }

    // Provider contract:
    // multipart fields: audio, mode
    // response: audio/* binary OR JSON { audio_base64, mime_type }
    const providerForm = new FormData();

    providerForm.append(
      "audio",
      new Blob([audioBuffer], {
        type: uploadedFile.mimetype
      }),
      uploadedFile.originalFilename || "audio-upload"
    );

    providerForm.append("mode", mode);

    let upstream;

    try {
      upstream = await fetch(providerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerKey}`,
          "x-api-key": providerKey,
          Accept: "audio/*, application/octet-stream, application/json"
        },
        body: providerForm,
        signal: AbortSignal.timeout(55000)
      });
    } catch (error) {
      console.error(
        "Voice Isolator provider connection failed:",
        error?.message || error
      );

      return sendError(
        res,
        error?.name === "TimeoutError" ? 504 : 502,
        "Could not reach the Voice Isolator provider."
      );
    }

    if (!upstream.ok) {
      console.error(
        "Voice Isolator provider status:",
        upstream.status
      );

      return sendError(
        res,
        upstream.status === 429 ? 429 : 502,
        upstream.status === 429
          ? "Provider quota exceeded. Try again later."
          : "Provider could not process this audio."
      );
    }

    const contentType = (
      upstream.headers.get("content-type") || ""
    ).toLowerCase();

    let outputBuffer;
    let mimeType;

    if (
      contentType.startsWith("audio/") ||
      contentType === "application/octet-stream"
    ) {
      outputBuffer = Buffer.from(await upstream.arrayBuffer());

      mimeType = contentType.startsWith("audio/")
        ? contentType
        : "audio/mpeg";
    } else {
      const result = await upstream.json().catch(() => null);
      const encoded = result?.audio_base64;

      if (!validBase64(encoded)) {
        return sendError(
          res,
          502,
          "Provider returned an unsupported audio response."
        );
      }

      outputBuffer = Buffer.from(encoded, "base64");
      mimeType = result.mime_type || "audio/mpeg";
    }

    if (
      !outputBuffer?.length ||
      outputBuffer.length > MAX_OUTPUT_SIZE
    ) {
      return sendError(
        res,
        502,
        "Provider returned empty or oversized audio."
      );
    }

    return sendSuccess(res, {
      audio_base64: outputBuffer.toString("base64"),
      mime_type: mimeType,
      mode,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error(
      "Voice Isolator API error:",
      error?.message || error
    );

    if (error?.code === "LIMIT_FILE_SIZE") {
      return sendError(
        res,
        413,
        "Audio file must be 25 MB or smaller."
      );
    }

    return sendError(
      res,
      500,
      "Voice isolation request failed."
    );
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
