
import formidable from "formidable";
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
  "audio/m4a",
  "audio/webm",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);

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

    uploadedFile = Array.isArray(files.media)
      ? files.media[0]
      : files.media;

    if (!uploadedFile) {
      return sendError(res, 400, "Upload a media file using the 'media' field.");
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio or video format.");
    }

    const languageValue = Array.isArray(fields.target_language)
      ? fields.target_language[0]
      : fields.target_language;

    const targetLanguage = typeof languageValue === "string"
      ? languageValue.trim()
      : "";

    if (!/^[a-zA-Z-]{2,35}$/.test(targetLanguage)) {
      return sendError(res, 400, "Select a valid target language.");
    }

    const usage = await checkAndUseAI(user, "dubbing");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Dubbing usage limit reached."
      );
    }

    // Read the temporary upload so malformed or unreadable files fail early.
    const fileBuffer = await readFile(uploadedFile.filepath);

    if (!fileBuffer.length) {
      return sendError(res, 400, "The uploaded file is empty.");
    }

    const providerUrl = process.env.DUBBING_API_URL;
    const providerKey = process.env.DUBBING_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendError(
        res,
        503,
        "Dubbing provider is not configured yet. Set DUBBING_API_URL and DUBBING_API_KEY."
      );
    }

    // Provider-specific multipart fields vary. Do not assume a generic API contract.
    // Connect the actual provider's documented upload/job endpoint here.
    return sendError(
      res,
      501,
      "Dubbing provider credentials are present, but its documented API adapter still needs to be configured."
    );
  } catch (error) {
    console.error("Dubbing API error:", error.message);

    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Media file must be 25 MB or smaller.");
    }

    return sendError(res, 500, "Dubbing request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
