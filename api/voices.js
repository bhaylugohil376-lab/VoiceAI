import { requireAuth } from "./_lib/auth.js";
import { sendError } from "./_lib/response.js";

const VOICES = [
  { voice_id: "alloy", name: "Alloy", category: "OpenAI", description: "Balanced, neutral voice" },
  { voice_id: "ash", name: "Ash", category: "OpenAI", description: "Clear, conversational voice" },
  { voice_id: "ballad", name: "Ballad", category: "OpenAI", description: "Warm, expressive voice" },
  { voice_id: "coral", name: "Coral", category: "OpenAI", description: "Bright, friendly voice" },
  { voice_id: "echo", name: "Echo", category: "OpenAI", description: "Smooth, lower-toned voice" },
  { voice_id: "fable", name: "Fable", category: "OpenAI", description: "Expressive storytelling voice" },
  { voice_id: "onyx", name: "Onyx", category: "OpenAI", description: "Deep, steady voice" },
  { voice_id: "nova", name: "Nova", category: "OpenAI", description: "Lively, upbeat voice" },
  { voice_id: "sage", name: "Sage", category: "OpenAI", description: "Measured, thoughtful voice" },
  { voice_id: "shimmer", name: "Shimmer", category: "OpenAI", description: "Light, clear voice" },
  { voice_id: "verse", name: "Verse", category: "OpenAI", description: "Flexible, expressive voice" }
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const search = typeof req.query?.search === "string"
      ? req.query.search.trim().toLowerCase().slice(0, 100)
      : "";
    const filtered = search
      ? VOICES.filter((voice) => `${voice.name} ${voice.voice_id} ${voice.description}`.toLowerCase().includes(search))
      : VOICES;

    return res.status(200).json({
      success: true,
      voices: filtered.map((voice) => ({ ...voice, labels: {}, preview_url: "" })),
      count: filtered.length,
      total_count: filtered.length,
      has_more: false,
      next_page_token: null,
      provider: "openai"
    });
  } catch (error) {
    console.error("OpenAI voices endpoint error:", error?.message || error);
    return sendError(res, 500, "Failed to load available voices.");
  }
}
