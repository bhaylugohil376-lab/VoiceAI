
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

const API_URL = "https://api.elevenlabs.io/v1";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return sendError(res, 503, "ElevenLabs API key is not configured.");
    }

    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voiceId = body.voice_id ?? body.voiceId;
    const requestedFormat = body.output_format ?? body.outputFormat;

    const allowedFormats = [
      "mp3_44100_128",
      "mp3_44100_192",
      "mp3_22050_32",
      "pcm_16000",
      "pcm_44100"
    ];

    if (!text) {
      return sendError(res, 400, "Please enter text to convert.");
    }

    if (text.length > 5000) {
      return sendError(res, 400, "Text must be 5000 characters or fewer.");
    }

    if (
      typeof voiceId !== "string" ||
      !/^[A-Za-z0-9_-]{5,100}$/.test(voiceId.trim())
    ) {
      return sendError(res, 400, "Please select a valid provider voice ID.");
    }

    const format = allowedFormats.includes(requestedFormat)
      ? requestedFormat
      : "mp3_44100_128";

    const modelValue = body.model_id ?? body.modelId;
    const modelId =
      typeof modelValue === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(modelValue)
        ? modelValue
        : "eleven_multilingual_v2";

    const usage = await checkAndUseAI(user, "tts");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const providerResponse = await fetch(
      `${API_URL}/text-to-speech/${encodeURIComponent(voiceId.trim())}?output_format=${encodeURIComponent(format)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: modelId
        })
      }
    );

    if (!providerResponse.ok) {
      const details = await providerResponse.text();

      console.error("ElevenLabs TTS error:", {
        status: providerResponse.status,
        details: details.slice(0, 400)
      });

      if ([401, 403].includes(providerResponse.status)) {
        return sendError(
          res,
          502,
          "ElevenLabs rejected the API key or permissions."
        );
      }

      if (providerResponse.status === 429) {
        return sendError(
          res,
          429,
          "ElevenLabs quota or rate limit reached."
        );
      }

      return sendError(
        res,
        502,
        "Audio generation failed. Check the voice ID, model and API access."
      );
    }

    const audioBuffer = Buffer.from(
      await providerResponse.arrayBuffer()
    );

    if (!audioBuffer.length) {
      return sendError(res, 502, "The provider returned empty audio.");
    }

    res.setHeader(
      "Content-Type",
      format.startsWith("pcm_") ? "audio/pcm" : "audio/mpeg"
    );
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "X-Usage-Remaining",
      usage.remaining == null ? "unlimited" : String(usage.remaining)
    );

    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error("TTS API error:", error);
    return sendError(
      res,
      500,
      "An unexpected error occurred during audio generation."
    );
  }
}
