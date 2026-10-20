
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  parseJsonBody,
  sendError
} from "./_lib/response.js";

const MAX_PROMPT_LENGTH = 1500;

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let timeout;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);

    if (!body) {
      return sendError(res, 400, "Send a valid JSON request.");
    }

    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";

    const duration = Number(body.duration ?? 5);

    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      return sendError(
        res,
        400,
        "Prompt is required and must be 1–1500 characters."
      );
    }

    if (!Number.isFinite(duration) || duration < 1 || duration > 30) {
      return sendError(
        res,
        400,
        "Duration must be between 1 and 30 seconds."
      );
    }

    const providerUrl = process.env.SOUND_EFFECTS_API_URL;
    const providerKey = process.env.SOUND_EFFECTS_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendError(
        res,
        503,
        "Sound Effects provider is not configured."
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(providerUrl);
    } catch {
      return sendError(res, 500, "Sound Effects provider URL is invalid.");
    }

    if (
      parsedUrl.protocol !== "https:" &&
      process.env.NODE_ENV === "production"
    ) {
      return sendError(
        res,
        500,
        "Production provider URL must use HTTPS."
      );
    }

    const usage = await checkAndUseAI(user, "sound_effects");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Sound Effects usage limit reached."
      );
    }

    const controller = new AbortController();

    timeout = setTimeout(() => controller.abort(), 90000);

    let providerResponse;

    try {
      providerResponse = await fetch(providerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${providerKey}`
        },
        body: JSON.stringify({
          prompt,
          duration
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
      timeout = undefined;
    }

    if (!providerResponse.ok) {
      console.error(
        "Sound Effects provider HTTP status:",
        providerResponse.status
      );

      return sendError(
        res,
        502,
        "Sound Effects provider failed. Check its API status and configuration."
      );
    }

    const contentType =
      providerResponse.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return sendError(
        res,
        502,
        "Provider returned a non-JSON response. A provider-specific adapter is required."
      );
    }

    const result = await providerResponse.json();

    const audioUrl =
      typeof result.audio_url === "string"
        ? result.audio_url
        : typeof result.url === "string"
          ? result.url
          : null;

    const jobId =
      typeof result.job_id === "string"
        ? result.job_id
        : typeof result.id === "string"
          ? result.id
          : null;

    const status =
      typeof result.status === "string"
        ? result.status
        : null;

    if (!audioUrl && !jobId) {
      return sendError(
        res,
        502,
        "Provider response did not include an audio URL or job ID."
      );
    }

    return res.status(200).json({
      success: true,
      status: status || (audioUrl ? "completed" : "processing"),
      audio_url: audioUrl,
      job_id: jobId,
      prompt,
      duration,
      remaining: usage.remaining
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(res, 504, "Sound Effects provider timed out.");
    }

    console.error("Sound Effects API error:", error.message);

    return sendError(res, 500, "Sound Effects generation failed.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
