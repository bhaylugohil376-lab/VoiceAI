
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError
} from "./_lib/response.js";

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

    const jobId =
      typeof body.job_id === "string" ? body.job_id.trim() : "";

    if (
      !jobId ||
      jobId.length > 200 ||
      !/^[a-zA-Z0-9_-]+$/.test(jobId)
    ) {
      return sendError(res, 400, "A valid dubbing job_id is required.");
    }

    const providerKey = process.env.DUBBING_API_KEY;
    const statusUrl = process.env.DUBBING_STATUS_API_URL;

    if (!providerKey || !statusUrl) {
      return sendError(
        res,
        503,
        "Dubbing status provider is not configured."
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(statusUrl);
    } catch {
      return sendError(res, 500, "Dubbing status URL is invalid.");
    }

    if (
      parsedUrl.protocol !== "https:" &&
      process.env.NODE_ENV === "production"
    ) {
      return sendError(
        res,
        500,
        "Production status URL must use HTTPS."
      );
    }

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 20000);

    let response;

    try {
      response = await fetch(parsedUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${providerKey}`
        },
        body: JSON.stringify({
          job_id: jobId
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
      timeout = undefined;
    }

    if (!response.ok) {
      console.error("Dubbing status provider HTTP status:", response.status);

      return sendError(
        res,
        502,
        "Could not retrieve dubbing status from the provider."
      );
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return sendError(
        res,
        502,
        "Dubbing provider returned an unexpected response format."
      );
    }

    const result = await response.json();

    const status = String(result.status || "").toLowerCase();

    const allowedStatuses = new Set([
      "queued",
      "pending",
      "processing",
      "completed",
      "failed"
    ]);

    if (!allowedStatuses.has(status)) {
      return sendError(
        res,
        502,
        "Provider returned an unrecognized job status."
      );
    }

    return res.status(200).json({
      success: true,
      job_id: jobId,
      status,
      ...(status === "completed" &&
      typeof result.audio_url === "string"
        ? { audio_url: result.audio_url }
        : {}),
      ...(status === "failed" &&
      typeof result.error === "string"
        ? { error: result.error.slice(0, 500) }
        : {})
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(res, 504, "Dubbing status request timed out.");
    }

    console.error("Dubbing status API error:", error.message);

    return sendError(res, 500, "Could not check dubbing status.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
