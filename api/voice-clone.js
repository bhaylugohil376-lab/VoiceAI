
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";
import { supabaseAdmin } from "./_lib/supabase.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/ogg",
  "audio/webm",
  "audio/flac"
]);

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploadedFile;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "Voice cloning provider is not configured.");
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
      return sendError(res, 400, "Upload an audio sample using the 'audio' field.");
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const nameValue = Array.isArray(fields.name) ? fields.name[0] : fields.name;
    const consentValue = Array.isArray(fields.consent)
      ? fields.consent[0]
      : fields.consent;

    const voiceName = typeof nameValue === "string" ? nameValue.trim() : "";

    if (voiceName.length < 2 || voiceName.length > 80) {
      return sendError(res, 400, "Voice name must be between 2 and 80 characters.");
    }

    if (consentValue !== "true") {
      return sendError(
        res,
        400,
        "Please confirm you have permission to clone this voice."
      );
    }

    const usage = await checkAndUseAI(user, "voice_clone");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Voice cloning usage limit reached."
      );
    }

    const audioBuffer = await readFile(uploadedFile.filepath);

    if (!audioBuffer.length) {
      return sendError(res, 400, "The uploaded audio file is empty.");
    }

    const audioBlob = new Blob([audioBuffer], {
      type: uploadedFile.mimetype
    });

    const providerForm = new FormData();
    providerForm.append("name", voiceName);
    providerForm.append("files", audioBlob, uploadedFile.originalFilename || "voice-sample.wav");

    const providerResponse = await fetch(
      "https://api.elevenlabs.io/v1/voices/add",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey
        },
        body: providerForm
      }
    );

    if (!providerResponse.ok) {
      const details = await providerResponse.text();

      console.error(
        "Voice clone provider error:",
        providerResponse.status,
        details.slice(0, 400)
      );

      if (providerResponse.status === 401 || providerResponse.status === 403) {
        return sendError(res, 502, "Voice provider rejected the API key or permissions.");
      }

      if (providerResponse.status === 429) {
        return sendError(res, 429, "Voice provider quota or rate limit reached.");
      }

      return sendError(res, 502, "Voice cloning failed at the provider.");
    }

    const result = await providerResponse.json();
    const voiceId = result.voice_id;

    if (!voiceId) {
      return sendError(res, 502, "Provider did not return a voice ID.");
    }

    const { error: saveError } = await supabaseAdmin
      .from("voice_clones")
      .insert({
        user_id: user.id,
        voice_id: voiceId,
        name: voiceName,
        status: "completed"
      });

    if (saveError) {
      console.error("Voice clone metadata save failed:", saveError.message);
    }

    return res.status(200).json({
      success: true,
      voice_id: voiceId,
      name: voiceName,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Voice clone API error:", error.message);

    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Audio sample must be 20 MB or smaller.");
    }

    return sendError(res, 500, "Voice cloning request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
