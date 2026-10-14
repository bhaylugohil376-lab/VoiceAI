import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";
import { supabaseAdmin } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST", "DELETE"])) {
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("favorite_voices")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Favorites list error:", error.message);
        return sendError(res, 500, "Could not load favorite voices.");
      }

      return sendSuccess(res, { favorites: data || [] });
    }

    const body = parseJsonBody(req);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendError(res, 400, "Invalid request body.");
    }

    const voiceId =
      typeof body.voice_id === "string" ? body.voice_id.trim() : "";

    if (!/^[A-Za-z0-9_-]{1,150}$/.test(voiceId)) {
      return sendError(res, 400, "A valid voice ID is required.");
    }

    if (req.method === "POST") {
      const { data, error } = await supabaseAdmin
        .from("favorite_voices")
        .upsert(
          {
            user_id: user.id,
            voice_id: voiceId
          },
          { onConflict: "user_id,voice_id" }
        )
        .select("*")
        .single();

      if (error) {
        console.error("Favorite save error:", error.message);
        return sendError(
          res,
          500,
          "Could not add this voice to favorites."
        );
      }

      return res.status(201).json({
        success: true,
        favorite: data
      });
    }

    const { data, error } = await supabaseAdmin
      .from("favorite_voices")
      .delete()
      .eq("user_id", user.id)
      .eq("voice_id", voiceId)
      .select("voice_id");

    if (error) {
      console.error("Favorite removal error:", error.message);
      return sendError(res, 500, "Could not remove this favorite.");
    }

    return sendSuccess(res, {
      removed: (data || []).length > 0,
      voice_id: voiceId
    });
  } catch (error) {
    console.error("Favorites API error:", error?.message || error);
    return sendError(res, 500, "Internal server error.");
  }
}
