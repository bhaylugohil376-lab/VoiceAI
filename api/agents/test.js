
import { requireUser } from "../_lib/auth.js";
import { checkAndUseAI } from "../_lib/usage.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "../_lib/response.js";
import { supabaseAdmin } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    const id =
      typeof body?.agent_id === "string" ? body.agent_id.trim() : "";

    if (!id || id.length > 100) {
      return sendError(res, 400, "A valid agent ID is required.");
    }

    const { data: agent, error } = await supabaseAdmin
      .from("agents")
      .select("id, config, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Agent test lookup failed:", error.message);
      return sendError(res, 500, "Could not load the agent.");
    }

    if (!agent) {
      return sendError(res, 404, "Agent not found.");
    }

    const config =
      agent.config && typeof agent.config === "object"
        ? agent.config
        : {};

    const providerAgentId = config.elevenlabs_agent_id;

    if (!providerAgentId || agent.status !== "deployed") {
      return sendError(
        res,
        409,
        "Deploy this agent before starting a voice conversation."
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "ElevenLabs is not configured.");
    }

    const usage = await checkAndUseAI(user, "agents");
    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const url = new URL(
      "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"
    );
    url.searchParams.set("agent_id", providerAgentId);

    const response = await fetch(url, {
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(20000)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.signed_url) {
      console.error(
        "Signed URL request failed:",
        response.status,
        JSON.stringify(result).slice(0, 400)
      );

      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        "Could not start the voice session. Check the deployed agent and provider quota."
      );
    }

    return sendSuccess(res, {
      signed_url: result.signed_url,
      provider: "elevenlabs",
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Agent voice session error:", error?.message || error);
    return sendError(res, 500, "Could not start the voice session.");
  }
}
