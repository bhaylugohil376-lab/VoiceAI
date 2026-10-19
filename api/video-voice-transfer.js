import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError, sendSuccess } from "./_lib/response.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function field(fields, name, fallback = "") {
  const value = first(fields[name]);
  return typeof value === "string" ? value.trim() : fallback;
}

function validHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFiles: 1,
    maxFileSize: MAX_FILE_SIZE,
    allowEmptyFiles: false,
    minFileSize: 1
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) return reject(error);
      resolve({ fields, files });
    });
  });
}

async function cleanup(file) {
  if (file?.filepath) {
    await unlink(file.filepath).catch(() => {});
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value) return null;

  const encoded = value.replace(/\s/g, "");

  if (
    encoded.length > Math.ceil(MAX_OUTPUT_BYTES / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    return null;
  }

  const buffer = Buffer.from(encoded, "base64");

  if (!buffer.length || buffer.length > MAX_OUTPUT_BYTES) return null;
  return buffer;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploaded;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const providerUrl = process.env.VIDEO_VOICE_TRANSFER_API_URL;
    const providerKey = process.env.VIDEO_VOICE_TRANSFER_API_KEY;

    if (!providerUrl || !validHttpsUrl(providerUrl) || !providerKey) {
      return sendError(res, 503, "Video voice-transfer provider is not configured.");
    }

    let parsed;

    try {
      parsed = await parseForm(req);
    } catch (error) {
      const tooLarge =
        error?.httpCode === 413 ||
        error?.code === 1009 ||
        /maxFileSize|larger than/i.test(error?.message || "");

      return sendError(
        res,
        tooLarge ? 413 : 400,
        tooLarge ? "Video must be under 4 MB." : "Invalid video upload."
      );
    }

    const { fields, files } = parsed;
    uploaded = first(files.file);

    if (!uploaded?.filepath || !uploaded.size) {
      await cleanup(uploaded);
      return sendError(res, 400, "Please upload a video file.");
    }

    const extension = path.extname(uploaded.originalFilename || "").toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      await cleanup(uploaded);
      return sendError(res, 400, "Supported formats: MP4, MOV and WebM.");
    }

    const voiceId = field(fields, "voiceId");
    const transferMode = field(fields, "transferMode", "voice");

    if (!voiceId || voiceId.length > 200) {
      await cleanup(uploaded);
      return sendError(res, 400, "Please select a valid voice.");
    }

    const similarity = Number(field(fields, "similarity", "75"));
    const clarity = Number(field(fields, "clarity", "75"));
    const expression = Number(field(fields, "expression", "50"));

    if (
      ![similarity, clarity, expression].every(
        value => Number.isFinite(value) && value >= 0 && value <= 100
      )
    ) {
      await cleanup(uploaded);
      return sendError(res, 400, "Settings must be between 0 and 100.");
    }

    const usage = await checkAndUseAI(user, "video_voice_transfer");

    if (!usage?.allowed) {
      return sendError(
        res,
        usage?.status || 429,
        usage?.error || "Usage limit reached."
      );
    }

    const videoBuffer = await readFile(uploaded.filepath);

    const form = new FormData();
    form.append(
      "file",
      new Blob([videoBuffer], {
        type: uploaded.mimetype || "application/octet-stream"
      }),
      uploaded.originalFilename || `video${extension}`
    );
    form.append("voiceId", voiceId);
    form.append("transferMode", transferMode);
    form.append("similarity", String(similarity));
    form.append("clarity", String(clarity));
    form.append("expression", String(expression));
    form.append("preserveMusic", field(fields, "preserveMusic", "false"));
    form.append("preserveTiming", field(fields, "preserveTiming", "true"));
    form.append("enhanceAudio", field(fields, "enhanceAudio", "false"));

    let providerResponse;

    try {
      providerResponse = await fetch(providerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerKey}`,
          "x-api-key": providerKey,
          Accept: "application/json, video/*"
        },
        body: form,
        signal: AbortSignal.timeout(55000)
      });
    } catch (error) {
      console.error("Video provider request failed:", error?.name || "NetworkError");
      await cleanup(uploaded);

      return sendError(
        res,
        error?.name === "TimeoutError" ? 504 : 502,
        "Video processing service could not be reached."
      );
    }

    if (!providerResponse.ok) {
      console.error("Video provider HTTP status:", providerResponse.status);
      await providerResponse.body?.cancel().catch(() => {});
      await cleanup(uploaded);

      return sendError(
        res,
        providerResponse.status === 429 ? 429 : 502,
        providerResponse.status === 429
          ? "Provider is busy or its quota has been reached."
          : "Video processing failed at the provider."
      );
    }

    let output;

    const contentType = (
      providerResponse.headers.get("content-type") || ""
    ).toLowerCase();

    if (contentType.startsWith("video/")) {
      const buffer = Buffer.from(await providerResponse.arrayBuffer());

      if (!buffer.length || buffer.length > MAX_OUTPUT_BYTES) {
        await cleanup(uploaded);
        return sendError(res, 502, "Provider returned invalid video output.");
      }

      output = {
        base64: buffer.toString("base64"),
        fileName: "voiceai-voice-transfer.mp4"
      };
    } else {
      let result;

      try {
        result = await providerResponse.json();
      } catch {
        await cleanup(uploaded);
        return sendError(res, 502, "Provider returned an unsupported response.");
      }

      const outputUrl = result.outputUrl || result.videoUrl || result.url;

      if (typeof outputUrl === "string" && outputUrl) {
        if (!validHttpsUrl(outputUrl)) {
          await cleanup(uploaded);
          return sendError(res, 502, "Provider returned an invalid video URL.");
        }

        output = {
          outputUrl,
          fileName: result.fileName || "voiceai-voice-transfer.mp4"
        };
      } else {
        const buffer = decodeBase64(result.base64);

        if (!buffer) {
          await cleanup(uploaded);
          return sendError(res, 502, "Provider returned no valid video output.");
        }

        output = {
          base64: buffer.toString("base64"),
          fileName: result.fileName || "voiceai-voice-transfer.mp4"
        };
      }
    }

    await cleanup(uploaded);

    return sendSuccess(res, {
      ...output,
      remaining: usage.remaining ?? null
    });
  } catch (error) {
    await cleanup(uploaded);
    console.error("Video voice-transfer error:", error?.message || "Unknown error");
    return sendError(res, 500, "An unexpected video-processing error occurred.");
  }
}
