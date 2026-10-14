import { requireUser } from "../_lib/auth.js";
import { sendError } from "../_lib/response.js";
import { supabaseAdmin } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "Voice provider is not configured");
    }

    const response = await fetch(
      "https://api.elevenlabs.io/v2/voices",
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(30000)
      }
    );

    if (!response.ok) {
      console.error("Voice sync provider error:", response.status);
      return sendError(res, 502, "Could not retrieve voice library");
    }

    const result = await response.json();
    const voices = Array.isArray(result.voices) ? result.voices : [];

    const rows = voices
      .filter(voice => voice.voice_id && voice.name)
      .map(voice => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category || null,
        description: voice.description || null,
        preview_url: voice.preview_url || null,
        provider: "elevenlabs"
      }));

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        synced: 0,
        message: "No voices were returned"
      });
    }

    const { error } = await supabaseAdmin
      .from("voices_library")
      .upsert(rows, { onConflict: "voice_id" });

    if (error) {
      console.error("Voice sync database error:", error.message);
      return sendError(res, 500, "Could not save voice library");
    }

    return res.status(200).json({
      success: true,
      synced: rows.length
    });
  } catch (error) {
    console.error("Voice sync error:", error.message);

    return sendError(
      res,
      error.name === "TimeoutError" ? 504 : 500,
      error.name === "TimeoutError"
        ? "Voice sync timed out"
        : "Internal server error"
    );
  }
}
