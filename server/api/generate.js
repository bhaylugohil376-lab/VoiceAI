import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_PROMPT_LENGTH = 12000;
const REQUEST_TIMEOUT_MS = 60000;

function makeWav(pcm) {
  const header = Buffer.alloc(44);
  const sampleRate = 44100;
  const channels = 1;
  const bitsPerSample = 16;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generateDialogue(req, res, user, body) {
  const speakers = Array.isArray(body.speakers) ? body.speakers : [];
  if (speakers.length < 2 || speakers.length > 3) {
    return sendError(res, 400, "Dialogue needs 2 or 3 speakers.");
  }

  const normalized = [];
  for (const [index, speaker] of speakers.entries()) {
    const voice = typeof speaker?.voice === "string" ? speaker.voice.trim() : "";
    const text = typeof speaker?.text === "string" ? speaker.text.trim() : "";
    if (!voice || !text) {
      return sendError(res, 400, `Speaker ${index + 1} needs a voice and dialogue text.`);
    }
    if (text.length > 3000) {
      return sendError(res, 400, `Speaker ${index + 1} text must be 3,000 characters or fewer.`);
    }
    normalized.push({ voice, text });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return sendError(res, 503, "Dialogue voice generation is not configured.");

  const usage = await checkAndUseAI(user, "dialogue");
  if (!usage.allowed) {
    return sendError(res, usage.status || 503, usage.error || "Dialogue usage limit reached.");
  }

  const voiceResponse = await fetch("https://api.elevenlabs.io/v1/voices?page_size=100", {
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
  });
  if (!voiceResponse.ok) {
    console.error("Dialogue voice lookup failed:", voiceResponse.status);
    return sendError(res, 502, "Could not load ElevenLabs voices for dialogue.");
  }
  const voicePayload = await voiceResponse.json();
  const availableVoices = Array.isArray(voicePayload.voices) ? voicePayload.voices : [];

  for (const speaker of normalized) {
    const match = availableVoices.find((voice) =>
      voice.voice_id === speaker.voice ||
      String(voice.name || "").toLowerCase() === speaker.voice.toLowerCase()
    );
    if (!match?.voice_id) {
      return sendError(
        res,
        400,
        `Voice "${speaker.voice}" was not found in your ElevenLabs voice library. Add/select an available voice first.`
      );
    }
    speaker.voiceId = match.voice_id;
  }

  const format = String(body.format || "mp3").toLowerCase();
  if (!["mp3", "wav"].includes(format)) {
    return sendError(res, 400, "Choose MP3 or WAV output.");
  }

  const chunks = [];
  for (const speaker of normalized) {
    const outputFormat = format === "wav" ? "pcm_44100" : "mp3_44100_128";
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(speaker.voiceId)}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: format === "wav" ? "audio/pcm" : "audio/mpeg"
        },
        body: JSON.stringify({
          text: speaker.text,
          model_id: "eleven_multilingual_v2"
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    );
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Dialogue TTS failed:", response.status, details.slice(0, 500));
      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "ElevenLabs quota or rate limit reached while generating dialogue."
          : "ElevenLabs failed to generate one of the speaker lines."
      );
    }
    const chunk = Buffer.from(await response.arrayBuffer());
    if (!chunk.length) return sendError(res, 502, "ElevenLabs returned empty dialogue audio.");
    chunks.push(chunk);
  }

  const rawAudio = Buffer.concat(chunks);
  const audio = format === "wav" ? makeWav(rawAudio) : rawAudio;
  const mimeType = format === "wav" ? "audio/wav" : "audio/mpeg";
  const audioUrl = `data:${mimeType};base64,${audio.toString("base64")}`;
  return sendSuccess(res, {
    type: "dialogue",
    format,
    audioUrl,
    url: audioUrl,
    audio_url: audioUrl,
    remaining: usage.remaining
  });
}

async function generateText(req, res, user, body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return sendError(res, 400, "Please enter a prompt.");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sendError(res, 400, `Prompt is too long. Maximum is ${MAX_PROMPT_LENGTH} characters.`);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return sendError(res, 503, "Gemini API is not configured yet.");

  const baseUrl = (
    process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\\/+$/, "");
  const usage = await checkAndUseAI(user, "assistant");
  if (!usage.allowed) {
    return sendError(res, usage.status || 429, usage.error || "Usage limit reached.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let actualModel = MODEL;
  try {
    response = await fetch(
      `${baseUrl}/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        }),
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok && response.status === 404 && MODEL !== "gemini-2.5-flash") {
    actualModel = "gemini-2.5-flash";
    response = await fetch(
      `${baseUrl}/models/${encodeURIComponent(actualModel)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    );
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Gemini generate request failed:", response.status, details.slice(0, 400));
    if (response.status === 429) return sendError(res, 429, "Gemini rate limit or quota reached. Please try again later.");
    return sendError(res, 502, "Gemini could not generate a response. Check the model, API key, and quota.");
  }

  const result = await response.json();
  const text = (result?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) return sendError(res, 502, "Gemini returned no text.");
  return sendSuccess(res, { text, model: actualModel, remaining: usage.remaining });
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    if (body?.type === "dialogue") return await generateDialogue(req, res, user, body);
    return await generateText(req, res, user, body);
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return sendError(res, 504, "AI request timed out. Please try again.");
    }
    console.error("Generate API error:", error?.message || error);
    return sendError(res, 500, "Something went wrong while generating content.");
  }
}
