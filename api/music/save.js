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

    const { title, audioUrl, duration, provider } = req.body || {};

    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof audioUrl !== "string" ||
      !audioUrl.trim()
    ) {
      return sendError(res, 400, "Title and audio URL are required");
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(audioUrl);
    } catch {
      return sendError(res, 400, "Invalid audio URL");
    }

    if (parsedUrl.protocol !== "https:") {
      return sendError(res, 400, "Audio URL must use HTTPS");
    }

    const safeDuration = Number(duration);

    const { data, error } = await supabaseAdmin
      .from("generated_music")
      .insert({
        user_id: user.id,
        title: title.trim().slice(0, 150),
        audio_url: parsedUrl.toString(),
        duration: Number.isFinite(safeDuration) && safeDuration > 0
          ? Math.min(Math.round(safeDuration), 3600)
          : null,
        provider: typeof provider === "string"
          ? provider.trim().slice(0, 50)
          : null
      })
      .select("id, title, audio_url, duration, provider, created_at")
      .single();

    if (error) {
      console.error("Music save error:", error.message);
      return sendError(res, 500, "Could not save music");
    }

    return res.status(201).json({
      success: true,
      music: data
    });
  } catch (error) {
    console.error("Music save route error:", error.message);
    return sendError(res, 500, "Internal server error");
  }
}
