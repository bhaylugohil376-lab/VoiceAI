import { requireUser } from "./_lib/auth.js";
import { supabaseAdmin } from "./_lib/supabase.js";
import { sendError } from "./_lib/response.js";

const FREE_LIMIT = 5;
const WINDOW_HOURS = 24;

const ALLOWED_ACTIONS = [
  "tts",
  "assistant",
  "image",
  "stt",
  "dubbing",
  "voice_clone",
  "voice_design",
  "voice_changer",
  "voice_isolator",
  "captions",
  "music",
  "sound_effects",
  "agents",
  "video_voice_transfer"
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(
      res,
      405,
      "Method not allowed."
    );
  }

  try {
    const user = await requireUser(req, res);

    if (!user?.id) {
      return;
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "Usage profile lookup failed:",
        profileError.message
      );

      return sendError(
        res,
        500,
        "Could not verify subscription."
      );
    }

    const plan = String(profile?.plan || "free")
      .trim()
      .toLowerCase();

    const actionParam = req.query?.action;
    const action = Array.isArray(actionParam)
      ? actionParam[0]
      : actionParam;

    if (
      action &&
      !ALLOWED_ACTIONS.includes(action)
    ) {
      return sendError(
        res,
        400,
        "Invalid or unsupported AI action."
      );
    }

    if (plan === "premium") {
      return res.status(200).json({
        success: true,
        plan: "premium",
        premium: true,
        limit: null,
        used: null,
        remaining: null,
        windowHours: WINDOW_HOURS
      });
    }

    const { data, error } = await supabaseAdmin
      .from("usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte(
        "created_at",
        new Date(
          Date.now() - WINDOW_HOURS * 60 * 60 * 1000
        ).toISOString()
      )
      .match(action ? { action } : {});

    if (error) {
      console.error(
        "Usage count lookup failed:",
        error.message
      );

      return sendError(
        res,
        500,
        "Could not retrieve usage information."
      );
    }

    const used = data?.length ?? 0;

    // Use the exact count returned by Supabase.
    // With head:true, count is provided separately.
    const countResult = await supabaseAdmin
      .from("usage_logs")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("user_id", user.id)
      .gte(
        "created_at",
        new Date(
          Date.now() - WINDOW_HOURS * 60 * 60 * 1000
        ).toISOString()
      )
      .match(action ? { action } : {});

    if (countResult.error) {
      return sendError(
        res,
        500,
        "Could not retrieve usage information."
      );
    }

    const actualUsed = countResult.count ?? used;

    return res.status(200).json({
      success: true,
      plan: "free",
      premium: false,
      action: action || null,
      limit: FREE_LIMIT,
      used: actualUsed,
      remaining: Math.max(
        0,
        FREE_LIMIT - actualUsed
      ),
      windowHours: WINDOW_HOURS
    });
  } catch (error) {
    console.error(
      "Usage endpoint error:",
      error?.message || error
    );

    return sendError(
      res,
      500,
      "Could not retrieve usage information."
    );
  }
}
