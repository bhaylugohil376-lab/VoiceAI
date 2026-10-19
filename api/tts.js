import OpenAI from "openai";
import { requireAuth } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { sendError, requireMethod, parseJsonBody } from "./_lib/response.js";

const MAX_TEXT_LENGTH = 5000;
const SUPPORTED_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable",
  "onyx", "nova", "sage", "shimmer", "verse"
]);
const SUPPORTED_MODELS = new Set([
  "gpt-4o-mini-tts", "tts-1", "tts-1-hd"
]);

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    if (!body || typeof body !== "object") {
      return sendError(res, 400, "Invalid JSON request body.");
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voice = typeof body.voice_id === "string" ? body.voice_id.trim() : "alloy";
    const model = typeof body.model_id === "string" && body.model_id.trim()
      ? body.model_id.trim()
      : "gpt-4o-mini-tts";

    if (!text) return sendError(res, 400, "Text is required.");
    if (text.length > MAX_TEXT_LENGTH) {
      return sendError(res, 400, `Text must be ${MAX_TEXT_LENGTH} characters or fewer.`);
    }
    if (!SUPPORTED_VOICES.has(voice)) {
      return sendError(res, 400, "Unsupported OpenAI voice. Choose a voice from the available list.");
    }
    if (!SUPPORTED_MODELS.has(model)) {
      return sendError(res, 400, "Unsupported text-to-speech model.");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "OpenAI TTS is not configured. Set OPENAI_API_KEY in your server environment.");
    }

    const usage = await checkAndUseAI(user, "tts");
    if (!usage.allowed) {
      return sendError(res, usage.status || 503, usage.error || "Unable to verify AI usage.");
    }

    const openai = new OpenAI({ apiKey, timeout: 55000, maxRetries: 0 });
    const audio = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: "mp3"
    });
    const audioBuffer = Buffer.from(await audio.arrayBuffer());

    if (!audioBuffer.length) return sendError(res, 502, "OpenAI returned empty audio.");

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error("OpenAI TTS endpoint error:", error?.message || error);
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.name === "APIConnectionTimeoutError") {
      return sendError(res, 504, "Text-to-speech generation timed out. Try shorter text.");
    }
    if (error?.status === 429) {
      return sendError(res, 429, "OpenAI rate limit or usage quota reached.");
    }
    return sendError(res, 502, "Text-to-speech generation failed. Please try again.");
  }
}
