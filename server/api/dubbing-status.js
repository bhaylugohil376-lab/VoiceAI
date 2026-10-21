import { requireUser } from "./_lib/auth.js";
import { requireMethod, parseJsonBody, sendError } from "./_lib/response.js";

const ELEVENLABS_DUBBING_URL = "https://api.elevenlabs.io/v1/dubbing";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    if (!body) return sendError(res, 400, "Send a valid JSON request.");

    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    const targetLanguage = typeof body.target_language === "string" ? body.target_language.trim().toLowerCase() : "";
    if (!jobId || jobId.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return sendError(res, 400, "A valid dubbing job_id is required.");
    }
    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(targetLanguage)) {
      return sendError(res, 400, "A valid target_language is required.");
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return sendError(res, 503, "Dubbing is not configured. Add ELEVENLABS_API_KEY.");

    const response = await fetch(`${ELEVENLABS_DUBBING_URL}/${encodeURIComponent(jobId)}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      console.error("ElevenLabs dubbing status failed:", response.status);
      return sendError(res, 502, "Could not retrieve dubbing status from ElevenLabs.");
    }

    const result = await response.json();
    const status = String(result.status || "").toLowerCase();
    if (status === "failed") return sendError(res, 502, "ElevenLabs reported that this dubbing job failed.");
    if (status !== "dubbed" && status !== "completed") {
      return res.status(200).json({ success: true, job_id: jobId, status: "processing" });
    }

    const audioResponse = await fetch(
      `${ELEVENLABS_DUBBING_URL}/${encodeURIComponent(jobId)}/audio/${encodeURIComponent(targetLanguage)}`,
      { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(20000) }
    );
    if (!audioResponse.ok) {
      console.error("ElevenLabs dubbing audio retrieval failed:", audioResponse.status);
      return sendError(res, 502, "Dubbing finished, but the output could not be downloaded.");
    }

    const mimeType = audioResponse.headers.get("content-type") || "audio/mpeg";
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    if (!buffer.length) return sendError(res, 502, "ElevenLabs returned an empty dubbed file.");
    const base64 = buffer.toString("base64");
    const isVideo = String(result.media_metadata?.content_type || "").startsWith("video/");
    return res.status(200).json({
      success: true,
      job_id: jobId,
      status: "completed",
      type: isVideo ? "video" : "audio",
      mediaType: isVideo ? "video" : "audio",
      mimeType,
      base64,
      outputUrl: `data:${mimeType};base64,${base64}`
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return sendError(res, 504, "Dubbing status request timed out.");
    }
    console.error("Dubbing status API error:", error.message);
    return sendError(res, 500, "Could not check dubbing status.");
  }
}
