
const { checkAndUseAI } = require("./_lib/usage");

const MAX_TEXT_LENGTH = 5000;
const ALLOWED_OUTPUT_FORMATS = new Set([
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "ulaw_8000",
]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "Text-to-speech service is not configured",
    });
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      error: "A JSON request body is required",
    });
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

  const outputFormat =
    typeof body.output_format === "string"
      ? body.output_format
      : "mp3_44100_128";

  if (!text) {
    return res.status(400).json({
      error: "Text is required",
    });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      error: `Text must not exceed ${MAX_TEXT_LENGTH} characters`,
    });
  }

  if (!voiceId || !/^[a-zA-Z0-9_-]+$/.test(voiceId)) {
    return res.status(400).json({
      error: "A valid voiceId is required",
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
    return res.status(400).json({
      error: "Invalid model_id",
    });
  }

  if (!ALLOWED_OUTPUT_FORMATS.has(outputFormat)) {
    return res.status(400).json({
      error: "Unsupported output_format",
    });
  }

  // IMPORTANT:
  // This assumes checkAndUseAI(req) returns:
  // { allowed: true } OR { allowed: false, status: 429, message: "..." }.
  // Match this call to the actual usage.js function contract before deploying.
  let usage;

  try {
    usage = await checkAndUseAI(req);
  } catch (error) {
    console.error("Usage check failed:", error.message);

    return res.status(503).json({
      error: "Could not verify usage limits",
    });
  }

  if (
    !usage ||
    typeof usage !== "object" ||
    usage.allowed !== true
  ) {
    const status =
      usage && [401, 403, 429].includes(usage.status)
        ? usage.status
        : 503;

    return res.status(status).json({
      error:
        usage && typeof usage.message === "string"
          ? usage.message
          : "Usage limit could not be verified",
    });
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
      const details = await upstream.text();

      console.error("ElevenLabs TTS error:", {
        status: upstream.status,
        details: details.slice(0, 1000),
      });

      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(502).json({
          error: "TTS provider authentication failed",
        });
      }

      if (upstream.status === 429) {
        return res.status(429).json({
          error: "TTS provider rate limit reached",
        });
      }

      if (upstream.status === 400 || upstream.status === 404) {
        return res.status(422).json({
          error: "Invalid TTS input or voice ID",
        });
      }

      return res.status(502).json({
        error: "TTS provider request failed",
      });
    }

    const audioBuffer = Buffer.from(await upstream.arrayBuffer());

    if (audioBuffer.length === 0) {
      return res.status(502).json({
        error: "TTS provider returned empty audio",
      });
    }

    res.setHeader(
      "Content-Type",
      outputFormat.startsWith("pcm_") ||
        outputFormat.startsWith("ulaw_")
        ? "application/octet-stream"
        : "audio/mpeg"
    );
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error("TTS request failed:", error.message);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "TTS provider timed out",
      });
    }

    return res.status(502).json({
      error: "Could not generate audio",
    });
  } finally {
    clearTimeout(timeout);
  }
};
