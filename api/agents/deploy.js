
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
    const id = typeof body?.id === "string" ? body.id.trim() : "";

    if (!id || id.length > 100) {
      return sendError(res, 400, "A valid saved agent ID is required.");
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "ElevenLabs is not configured.");
    }

    const { data: agent, error: loadError } = await supabaseAdmin
      .from("agents")
      .select("id, name, description, type, config, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadError) {
      console.error("Agent lookup failed:", loadError.message);
      return sendError(res, 500, "Could not load the agent.");
    }

    if (!agent) {
      return sendError(res, 404, "Agent not found.");
    }

    const config =
      agent.config && typeof agent.config === "object"
        ? agent.config
        : {};

    if (config.elevenlabs_agent_id && agent.status === "deployed") {
      return sendSuccess(res, {
        message: "Agent is already deployed.",
        provider: "elevenlabs",
        provider_agent_id: config.elevenlabs_agent_id
      });
    }

    const systemPrompt =
      typeof config.system_prompt === "string"
        ? config.system_prompt.trim()
        : "";

    const voiceId =
      typeof config.voice_id === "string" ? config.voice_id.trim() : "";

    if (!systemPrompt) {
      return sendError(res, 400, "Add system instructions before deployment.");
    }

    if (!voiceId) {
      return sendError(
        res,
        400,
        "Select a real ElevenLabs voice ID before deployment."
      );
    }

    const usage = await checkAndUseAI(user, "agents");
    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const language = config.language || "en";

    const providerResponse = await fetch(
      "https://api.elevenlabs.io/v1/convai/agents/create",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          name: agent.name,
          conversation_config: {
            agent: {
              prompt: { prompt: systemPrompt },
              first_message:
                config.welcome_message ||
                "Hello! How can I help you today?",
              language
            },
            tts: { voice_id: voiceId }
          },
          tags: ["voiceai", `voiceai-user-${user.id}`]
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const result = await providerResponse.json().catch(() => ({}));

    if (!providerResponse.ok || !result.agent_id) {
      console.error(
        "ElevenLabs deployment failed:",
        providerResponse.status,
        JSON.stringify(result).slice(0, 400)
      );

      return sendError(
        res,
        providerResponse.status === 429 ? 429 : 502,
        "Deployment failed. Verify the ElevenLabs API key, voice ID and account access."
      );
    }

    const updatedConfig = {
      ...config,
      elevenlabs_agent_id: result.agent_id,
      deployed_at: new Date().toISOString()
    };

    const { error: saveError } = await supabaseAdmin
      .from("agents")
      .update({
        config: updatedConfig,
        status: "deployed",
        updated_at: new Date().toISOString()
      })
      .eq("id", agent.id)
      .eq("user_id", user.id);

    if (saveError) {
      console.error("Deployment record save failed:", saveError.message);
      return sendError(
        res,
        500,
        "Provider created the agent, but saving its ID failed. Check the database before retrying."
      );
    }

    return sendSuccess(res, {
      message: "Agent deployed successfully.",
      provider: "elevenlabs",
      provider_agent_id: result.agent_id,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Agent deployment error:", error?.message || error);
    return sendError(
      res,
      error?.name === "TimeoutError" ? 504 : 500,
      "Agent deployment failed."
    );
  }
}
