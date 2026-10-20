
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

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);

    if (!body) {
      return sendError(res, 400, "Send a valid JSON request.");
    }

    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";

    const style =
      typeof body.style === "string" ? body.style.trim() : "cinematic";

    const duration = Number(body.duration ?? 30);

    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      return sendError(
        res,
        400,
        "Prompt is required and must be 1–1500 characters."
      );
    }

    if (!/^[a-zA-Z0-9 _-]{1,60}$/.test(style)) {
      return sendError(res, 400, "Invalid music style.");
    }

    if (!Number.isFinite(duration) || duration < 5 || duration > 180) {
      return sendError(
        res,
        400,
        "Duration must be between 5 and 180 seconds."
      );
    }

    const providerUrl = process.env.MUSIC_API_URL;
    const providerKey = process.env.MUSIC_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendError(
        res,
        503,
        "Music generation provider is not configured."
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(providerUrl);
    } catch {
      return sendError(res, 500, "Music provider URL is invalid.");
    }

    if (
      parsedUrl.protocol !== "https:" &&
      process.env.NODE_ENV === "production"
    ) {
      return sendError(
        res,
        500,
        "Production music provider URL must use HTTPS."
      );
    }

    const usage = await checkAndUseAI(user, "music");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Music generation limit reached."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

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
          style,
          duration
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!providerResponse.ok) {
      console.error(
        "Music provider returned HTTP status:",
        providerResponse.status
      );

      return sendError(
        res,
        502,
        "The music provider could not generate audio. Check its API status and configuration."
      );
    }

    const contentType =
      providerResponse.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return sendError(
        res,
        502,
        "The provider returned a non-JSON response. Its adapter must be configured for that response format."
      );
    }

    const result = await providerResponse.json();

    const audioUrl =
      typeof result.audio_url === "string"
        ? result.audio_url
        : typeof result.url === "string"
          ? result.url
          : null;

    const providerJobId =
      typeof result.job_id === "string"
        ? result.job_id
        : typeof result.id === "string"
          ? result.id
          : null;

    const status =
      typeof result.status === "string"
        ? result.status
        : null;

    if (!audioUrl && !providerJobId) {
      return sendError(
        res,
        502,
        "The provider response did not contain an audio URL or job ID."
      );
    }

    return res.status(200).json({
      success: true,
      status: status || (audioUrl ? "completed" : "processing"),
      audio_url: audioUrl,
      job_id: providerJobId,
      prompt,
      style,
      duration,
      remaining: usage.remaining
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(
        res,
        504,
        "Music provider timed out. Check the provider's job status before retrying."
      );
    }

    console.error("Music API error:", error.message);

    return sendError(res, 500, "Music generation request failed.");
  }
}
