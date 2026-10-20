
import formidable from "formidable";
import OpenAI, { toFile } from "openai";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/x-m4a"
]);

function timestamp(seconds, comma = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);

  const separator = comma ? "," : ".";

  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")}` +
    `${separator}${String(millis).padStart(3, "0")}`
  );
}

function makeSRT(segments = []) {
  return segments.map((segment, index) => {
    const start = timestamp(segment.start, true);
    const end = timestamp(segment.end, true);
    const text = String(segment.text || "").trim();

    return `${index + 1}\n${start} --> ${end}\n${text}`;
  }).join("\n\n");
}

function makeVTT(segments = []) {
  const cues = segments.map(segment => {
    const start = timestamp(segment.start, false);
    const end = timestamp(segment.end, false);
    const text = String(segment.text || "").trim();

    return `${start} --> ${end}\n${text}`;
  }).join("\n\n");

  return `WEBVTT\n\n${cues}`;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploadedFile;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (!process.env.OPENAI_API_KEY) {
      return sendError(res, 503, "Caption service is not configured.");
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

    uploadedFile = Array.isArray(files.audio)
      ? files.audio[0]
      : files.audio;

    if (!uploadedFile) {
      return sendError(
        res,
        400,
        "Upload an audio file using the 'audio' field."
      );
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const buffer = await readFile(uploadedFile.filepath);

    if (!buffer.length) {
      return sendError(res, 400, "The audio file is empty.");
    }

    const languageValue = Array.isArray(fields.language)
      ? fields.language[0]
      : fields.language;

    const language =
      typeof languageValue === "string"
        ? languageValue.trim()
        : "";

    if (language && !/^[a-zA-Z-]{2,20}$/.test(language)) {
      return sendError(res, 400, "Invalid language code.");
    }

    const usage = await checkAndUseAI(user, "captions");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Caption usage limit reached."
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const audioFile = await toFile(
      buffer,
      uploadedFile.originalFilename || "audio.wav",
      { type: uploadedFile.mimetype || "audio/wav" }
    );

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      ...(language ? { language } : {})
    });

    const segments = Array.isArray(transcription.segments)
      ? transcription.segments
      : [];

    const text = String(transcription.text || "").trim();

    if (!text) {
      return sendError(res, 422, "No speech was detected in the audio.");
    }

    return res.status(200).json({
      success: true,
      text,
      language: transcription.language || language || null,
      duration: transcription.duration || null,
      segments,
      srt: makeSRT(segments),
      vtt: makeVTT(segments),
      model: "whisper-1",
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Captions API error:", error.message);

    if (
      error.code === "LIMIT_FILE_SIZE" ||
      error.httpCode === 413
    ) {
      return sendError(res, 413, "Audio file must be 25 MB or smaller.");
    }

    if (error.status === 401) {
      return sendError(res, 502, "The transcription provider rejected the API key.");
    }

    if (error.status === 429) {
      return sendError(res, 503, "The transcription provider is busy or its quota is exhausted.");
    }

    return sendError(res, 500, "Caption generation failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
