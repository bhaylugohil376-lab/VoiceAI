
const { requireUser } = require("./_lib/auth");
const { sendError } = require("./_lib/response");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 500, "ELEVENLABS_API_KEY is not configured.");
    }

    const params = new URLSearchParams();
    params.set("page_size", "100");
    params.set("include_total_count", "true");

    const token = typeof req.query?.next_page_token === "string"
      ? req.query.next_page_token
      : "";

    const search = typeof req.query?.search === "string"
      ? req.query.search.trim().slice(0, 100)
      : "";

    if (token) params.set("next_page_token", token);
    if (search) params.set("search", search);

    const response = await fetch(
      "https://api.elevenlabs.io/v2/voices?" + params.toString(),
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error("ElevenLabs voices error:", response.status, details);
      return sendError(res, 502, "Unable to retrieve real voices from ElevenLabs.");
    }

    const data = await response.json();

    return res.status(200).json({
      success: true,
      voices: (data.voices || []).map((voice) => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category || "",
        description: voice.description || "",
        labels: voice.labels || {},
        preview_url: voice.preview_url || ""
      })),
      count: (data.voices || []).length,
      total_count: data.total_count ?? null,
      has_more: Boolean(data.has_more),
      next_page_token: data.next_page_token || null
    });
  } catch (error) {
    console.error("Voices endpoint error:", error);
    return sendError(res, 500, "Failed to load voices.");
  }
};
