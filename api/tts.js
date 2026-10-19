
const { supabaseAdmin } = require("./_lib/supabase");
const { checkAndUseAI } = require("./_lib/usage");

const SUPPORT_EMAIL = "bhaylugohil376@gmail.com";
const MAX_TEXT_LENGTH = 5000;

const ALLOWED_FORMATS = new Set([
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "ulaw_8000",
]);

function sendError(res, status, message) {
  return res.status(status).json({
    error: message,
    support: SUPPORT_EMAIL,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed");
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return sendError(res, 503, "TTS service is not configured");
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return sendError(res, 401, "Authentication required");
  }

  let user;

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(match[1]);

    if (error || !data?.user?.id) {
      return sendError(res, 401, "Invalid or expired access token");
    }

    user = data.user;
  } catch (error) {
    console.error("Authentication failed:", error.message);
    return sendError(res, 503, "Could not verify authentication");
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendError(res, 400, "A valid JSON body is required");
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId =
    typeof body.voiceId === "string"
      ? body.voiceId.trim()
      : typeof body.voice_id === "string"
        ? body.voice_id.trim()
        : "";

  const modelId =
    typeof body.model_id === "string" && body.model_id.trim()
      ? body.model_id.trim()
      : "eleven_multilingual_v2";

  const outputFormat = body.output_format || "mp3_44100_128";

  if (!text) {
    return sendError(res, 400, "Text is required");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return sendError(res, 400, "Text is too long");
  }

  if (!voiceId || !/^[a-zA-Z0-9_-]+$/.test(voiceId)) {
    return sendError(res, 400, "A valid voiceId is required");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
    return sendError(res, 400, "Invalid model_id");
  }

  if (!ALLOWED_FORMATS.has(outputFormat)) {
    return sendError(res, 400, "Unsupported output_format");
  }

  let usage;

  try {
    usage = await checkAndUseAI(user, "tts");
  } catch (error) {
    console.error("Usage check failed:", error.message);
    return sendError(res, 503, "Could not verify usage limits");
  }

  if (!usage || usage.allowed !== true) {
    const status =
      usage && [400, 401, 403, 429].includes(usage.status)
        ? usage.status
        : 503;

    return sendError(
      res,
      status,
      usage?.error || "Usage limit verification failed"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    );
    url.searchParams.set("output_format", outputFormat);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg, application/octet-stream",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      console.error("ElevenLabs TTS failed with status:", upstream.status);

      if (upstream.status === 429) {
        return sendError(res, 429, "TTS provider rate limit reached");
      }

      if ([400, 404].includes(upstream.status)) {
        return sendError(res, 422, "Invalid TTS input or voice ID");
      }

      return sendError(res, 502, "TTS provider request failed");
    }

    const audio = Buffer.from(await upstream.arrayBuffer());

    if (!audio.length) {
      return sendError(res, 502, "TTS provider returned empty audio");
    }

    const isRaw =
      outputFormat.startsWith("pcm_") ||
      outputFormat.startsWith("ulaw_");

    res.setHeader(
      "Content-Type",
      isRaw ? "application/octet-stream" : "audio/mpeg"
    );
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(audio);
  } catch (error) {
    console.error("TTS request failed:", error.message);

    if (error.name === "AbortError") {
      return sendError(res, 504, "TTS provider timed out");
    }

    return sendError(res, 502, "Could not generate audio");
  } finally {
    clearTimeout(timeout);
  }
};
