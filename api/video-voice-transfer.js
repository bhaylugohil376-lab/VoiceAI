
import formidable from "formidable";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  sendError,
  sendSuccess
} from "./_lib/response.js";

// Vercel must receive the raw multipart request.
export const config = {
  api: {
    bodyParser: false
  }
};

// Keep below the typical serverless request-body limit.
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

function firstString(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getField(fields, name, fallback = "") {
  const value = firstString(fields[name]);
  return typeof value === "string" ? value.trim() : fallback;
}

function getBooleanField(fields, name, fallback = false) {
  const value = getField(fields, name, String(fallback)).toLowerCase();
  return value === "true" || value === "1";
}

function parseMultipart(req) {
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

function validProviderUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    // Authenticate the signed-in VoiceAI user.
    const user = await requireUser(req, res);
    if (!user) return;

    const providerUrl = process.env.VIDEO_VOICE_TRANSFER_API_URL;
    const providerKey = process.env.VIDEO_VOICE_TRANSFER_API_KEY;

    if (!providerUrl || !validProviderUrl(providerUrl) || !providerKey) {
      return sendError(
        res,
        503,
        "Video voice-transfer provider is not configured."
      );
    }

    let parsed;

    try {
      parsed = await parseMultipart(req);
    } catch (error) {
      if (
        error?.code === 1009 ||
        error?.httpCode === 413 ||
        /maxFileSize|larger than/i.test(error?.message || "")
      ) {
        return sendError(
          res,
          413,
          "Video is too large. Please upload a video under 4 MB."
        );
      }

      return sendError(
        res,
        400,
        "Could not read the uploaded video. Please try again."
      );
    }

    const { fields, files } = parsed;
    const uploaded = firstString(files.file);

    if (!uploaded?.filepath) {
      return sendError(res, 400, "Please upload a video file.");
    }

    const extension = path.extname(
      uploaded.originalFilename || ""
    ).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return sendError(
        res,
        400,
        "Supported video formats are MP4, MOV and WebM."
      );
    }

    if (uploaded.size > MAX_FILE_SIZE) {
      return sendError(
        res,
        413,
        "Video is too large. Please upload a video under 4 MB."
      );
    }

    const voiceId = getField(fields, "voiceId");
    const transferMode = getField(fields, "transferMode", "voice");

    if (!voiceId || voiceId.length > 200) {
      return sendError(res, 400, "Please select a valid AI voice.");
    }

    if (!transferMode || transferMode.length > 50) {
      return sendError(res, 400, "Invalid transfer mode.");
    }

    const similarity = Number(getField(fields, "similarity", "75"));
    const clarity = Number(getField(fields, "clarity", "75"));
    const expression = Number(getField(fields, "expression", "50"));

    for (const [name, value] of Object.entries({
      similarity,
      clarity,
      expression
    })) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return sendError(
          res,
          400,
          `${name} must be between 0 and 100.`
        );
      }
    }

    // Consume a use only after request and file validation.
    const usage = await checkAndUseAI(user, "video_voice_transfer");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Your usage limit has been reached."
      );
    }

    const videoBuffer = await readFile(uploaded.filepath);
    const outboundForm = new FormData();

    outboundForm.append(
      "file",
      new Blob([videoBuffer], {
        type: uploaded.mimetype || "application/octet-stream"
      }),
      uploaded.originalFilename || `upload${extension}`
    );

    outboundForm.append("voiceId", voiceId);
    outboundForm.append("transferMode", transferMode);
    outboundForm.append("similarity", String(similarity));
    outboundForm.append("clarity", String(clarity));
    outboundForm.append("expression", String(expression));
    outboundForm.append(
      "preserveMusic",
      String(getBooleanField(fields, "preserveMusic"))
    );
    outboundForm.append(
      "preserveTiming",
      String(getBooleanField(fields, "preserveTiming", true))
    );
    outboundForm.append(
      "enhanceAudio",
      String(getBooleanField(fields, "enhanceAudio"))
    );

    let providerResponse;

    try {
      providerResponse = await fetch(providerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerKey}`,
          "x-api-key": providerKey,
          Accept: "application/json, video/mp4"
        },
        body: outboundForm,
        signal: AbortSignal.timeout(180000)
      });
    } catch (error) {
      console.error("Video voice-transfer provider request failed:", error.message);

      return sendError(
        res,
        error?.name === "TimeoutError" ? 504 : 502,
        "The video processing service could not be reached. Please try again."
      );
    }

    if (!providerResponse.ok) {
      const detail = await providerResponse.text().catch(() => "");

      console.error(
        "Video voice-transfer provider returned an error:",
        providerResponse.status,
        detail.slice(0, 300)
      );

      if (providerResponse.status === 429) {
        return sendError(
          res,
          429,
          "The voice provider is busy or its quota has been reached."
        );
      }

      return sendError(
        res,
        502,
        "The voice provider could not process this video."
      );
    }

    const contentType =
      providerResponse.headers.get("content-type") || "";

    // Some adapters return the rendered MP4 directly.
    if (contentType.toLowerCase().startsWith("video/")) {
      const outputBuffer = Buffer.from(
        await providerResponse.arrayBuffer()
      );

      if (!outputBuffer.length || outputBuffer.length > 20 * 1024 * 1024) {
        return sendError(
          res,
          502,
          "The provider returned an empty or oversized video result. Configure it to return a hosted video URL."
        );
      }

      return sendSuccess(res, {
        base64: outputBuffer.toString("base64"),
        fileName: "voiceai-voice-transfer.mp4",
        remaining: usage.remaining ?? null
      });
    }

    let result;

    try {
      result = await providerResponse.json();
    } catch {
      return sendError(
        res,
        502,
        "The provider returned an invalid response. It must return a video URL or base64 video."
      );
    }

    const outputUrl =
      result.outputUrl ||
      result.videoUrl ||
      result.url;

    const base64 = result.base64;

    if (typeof outputUrl === "string" && outputUrl.trim()) {
      if (!validProviderUrl(outputUrl)) {
        return sendError(
          res,
          502,
          "The provider returned an invalid video URL."
        );
      }

      return sendSuccess(res, {
        outputUrl,
        fileName: result.fileName || "voiceai-voice-transfer.mp4",
        title: result.title || "Transformed Video",
        remaining: usage.remaining ?? null
      });
    }

    if (
      typeof base64 === "string" &&
      base64.length > 0 &&
      base64.length <= 28 * 1024 * 1024 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      return sendSuccess(res, {
        base64,
        fileName: result.fileName || "voiceai-voice-transfer.mp4",
        title: result.title || "Transformed Video",
        remaining: usage.remaining ?? null
      });
    }

    return sendError(
      res,
      502,
      "The provider response did not contain a valid video URL or base64 output."
    );
  } catch (error) {
    console.error(
      "Video voice-transfer API error:",
      error?.message || error
    );

    return sendError(
      res,
      500,
      "An unexpected error occurred while processing the video."
    );
  }
}
