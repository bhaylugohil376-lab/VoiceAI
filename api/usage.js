
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import { requireMethod, sendError } from "./_lib/response.js";

const FREE_LIMIT = 5;
const WINDOW_HOURS = 24;

// Keep these action names aligned with checkAndUseAI()
// calls throughout the api/ directory.
const AI_ACTIONS = [
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
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const requestedAction =
      typeof req.query?.action === "string"
        ? req.query.action.trim()
        : "";

    if (
      requestedAction &&
      !AI_ACTIONS.includes(requestedAction)
    ) {
      return sendError(res, 400, "Unknown usage action.");
    }

    // Read the current user's plan.
    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "Plan lookup failed:",
        profileError.message
      );

      return sendError(
        res,
        500,
        "Could not load your plan."
      );
    }

    const plan = String(profile?.plan || "free")
      .trim()
      .toLowerCase();

    const premium = plan === "premium";

    const since = new Date(
      Date.now() - WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();

    const counts = Object.fromEntries(
      AI_ACTIONS.map((action) => [action, 0])
    );

    // Premium users do not have a free usage limit.
    if (!premium) {
      const { data: logs, error: logsError } =
        await supabaseAdmin
          .from("usage_logs")
          .select("action")
          .eq("user_id", user.id)
          .gte("created_at", since)
          .in("action", AI_ACTIONS);

      if (logsError) {
        console.error(
          "Usage log lookup failed:",
          logsError.message
        );

        return sendError(
          res,
          500,
          "Could not load usage details."
        );
      }

      for (const log of logs || []) {
        if (
          Object.prototype.hasOwnProperty.call(
            counts,
            log.action
          )
        ) {
          counts[log.action] += 1;
        }
      }
    }

    // Single-tool response:
    // GET /api/usage?action=agents
    // GET /api/usage?action=tts
    if (requestedAction) {
      const used = premium
        ? 0
        : counts[requestedAction] || 0;

      return res.status(200).json({
        success: true,
        action: requestedAction,
        plan: premium ? "premium" : "free",
        premium,
        unlimited: premium,
        limit: premium ? null : FREE_LIMIT,
        used,
        remaining: premium
          ? null
          : Math.max(0, FREE_LIMIT - used),
        window_hours: WINDOW_HOURS
      });
    }

    // Full usage summary for the dashboard.
    const tools = Object.fromEntries(
      AI_ACTIONS.map((action) => {
        const used = premium ? 0 : counts[action] || 0;

        return [
          action,
          {
            limit: premium ? null : FREE_LIMIT,
            used,
            remaining: premium
              ? null
              : Math.max(0, FREE_LIMIT - used),
            unlimited: premium
          }
        ];
      })
    );

    return res.status(200).json({
      success: true,
      plan: premium ? "premium" : "free",
      premium,
      limit_per_tool: premium ? null : FREE_LIMIT,
      window_hours: WINDOW_HOURS,
      tools
    });
  } catch (error) {
    console.error(
      "Usage API error:",
      error?.message || error
    );

    return sendError(
      res,
      500,
      "Could not retrieve usage summary."
    );
  }
}
