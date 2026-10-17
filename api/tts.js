
const { requireUser } = require("./_lib/auth");
const { sendError } = require("./_lib/response");
const { checkAndUseAI } = require("./_lib/usage");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 500, "ElevenLabs API key is not configured.");
    }

    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voiceId =
      typeof body.voice_id === "string" ? body.voice_id.trim() : "";
    const outputFormat = body.output_format || "mp3_44100_128";

    if (!text) {
      return sendError(res, 400, "Please enter text to convert.");
    }

    if (text.length > 5000) {
      return sendError(res, 400, "Text cannot exceed 5000 characters.");
    }

    if (!/^[A-Za-z0-9_-]{5,100}$/.test(voiceId)) {
      return sendError(res, 400, "Please select a valid voice.");
    }

    const allowedFormats = [
      "mp3_44100_128",
      "mp3_22050_32",
      "pcm_16000"
    ];

    if (!allowedFormats.includes(outputFormat)) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    // Check the user's quota before calling the provider.
    const usage = await checkAndUseAI(user, "tts");
    if (usage === false) {
      return sendError(res, 429, "Your AI usage limit has been reached.");
    }

    const apiUrl =
      "https://api.elevenlabs.io/v1/text-to-speech/" +
      encodeURIComponent(voiceId) +
      "?output_format=" +
      encodeURIComponent(outputFormat);

    const providerResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!providerResponse.ok) {
      const detail = await providerResponse.text();

      console.error("ElevenLabs error:", providerResponse.status, detail);

      return sendError(
        res,
        providerResponse.status === 429 ? 429 : 502,
        providerResponse.status === 429
          ? "ElevenLabs rate limit or quota reached."
          : "ElevenLabs could not generate audio. Check the API key and voice."
      );
    }

    const audioBuffer = Buffer.from(
      await providerResponse.arrayBuffer()
    );

    if (!audioBuffer.length) {
      return sendError(res, 502, "The audio provider returned an empty file.");
    }

    res.setHeader(
      "Content-Type",
      outputFormat.startsWith("pcm_") ? "audio/pcm" : "audio/mpeg"
    );
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error("TTS endpoint error:", error);
    return sendError(res, 500, "Speech generation failed. Please try again.");
  }
};
