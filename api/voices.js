
import { requireUser } from "./_lib/auth.js";
import { requireMethod, sendError } from "./_lib/response.js";

const API_URL = "https://api.elevenlabs.io/v1";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return sendError(res, 503, "Voice provider is not configured.");
    }

    const search =
      typeof req.query?.search === "string"
        ? req.query.search.trim().slice(0, 100).toLowerCase()
        : "";

    const category =
      typeof req.query?.category === "string"
        ? req.query.category.trim().toLowerCase()
        : "";

    const pageSize = Math.min(
      Math.max(
        Number.parseInt(req.query?.page_size || "100", 10) || 100,
        1
      ),
      100
    );

    const params = new URLSearchParams({
      page_size: String(pageSize)
    });

    const pageToken =
      typeof req.query?.next_page_token === "string"
        ? req.query.next_page_token.trim()
        : "";

    if (pageToken) {
      if (pageToken.length > 500) {
        return sendError(res, 400, "Invalid pagination token.");
      }

      params.set("next_page_token", pageToken);
    }

    const response = await fetch(
      `${API_URL}/voices?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      console.error("ElevenLabs voices request failed:", response.status);

      await response.body?.cancel().catch(() => {});

      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "Voice provider rate limit reached. Try again shortly."
          : "Could not load voices from the provider."
      );
    }

    const payload = await response.json();

    if (!Array.isArray(payload.voices)) {
      return sendError(res, 502, "Voice provider returned invalid data.");
    }

    let voices = payload.voices
      .filter(
        voice =>
          typeof voice.voice_id === "string" &&
          typeof voice.name === "string"
      )
      .map(voice => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category || "general",
        description: voice.description || "",
        labels: voice.labels || {},
        preview_url: voice.preview_url || null,
        available_for_tiers: voice.available_for_tiers || [],
        high_quality_base_model_ids:
          voice.high_quality_base_model_ids || []
      }));

    if (search) {
      voices = voices.filter(voice =>
        [
          voice.name,
          voice.description,
          voice.category,
          ...Object.values(voice.labels).filter(
            value => typeof value === "string"
          )
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)
      );
    }

    if (category && category !== "all") {
      voices = voices.filter(
        voice => String(voice.category).toLowerCase() === category
      );
    }

    res.setHeader("Cache-Control", "private, max-age=60");

    return res.status(200).json({
      success: true,
      voices,
      count: voices.length,
      has_more: Boolean(payload.has_more),
      next_page_token: payload.next_page_token || null
    });
  } catch (error) {
    console.error(
      "Voices API error:",
      error?.name || "UnexpectedError"
    );

    return sendError(
      res,
      error?.name === "TimeoutError" ? 504 : 500,
      error?.name === "TimeoutError"
        ? "Loading voices timed out. Try again."
        : "Could not load voices."
    );
  }
}
