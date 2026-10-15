
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
    const agentId =
      typeof body?.agent_id === "string" ? body.agent_id.trim() : "";
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";

    if (!agentId || agentId.length > 100) {
      return sendError(res, 400, "Valid agent ID is required.");
    }

    if (!message || message.length > 4000) {
      return sendError(res, 400, "Message must be 1–4000 characters.");
    }

    const { data: agent, error } = await supabaseAdmin
      .from("agents")
      .select("id, config")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Agent lookup failed:", error.message);
      return sendError(res, 500, "Could not load agent.");
    }

    if (!agent) {
      return sendError(res, 404, "Agent not found.");
    }

    const config =
      agent.config && typeof agent.config === "object"
        ? agent.config
        : {};

    const systemPrompt =
      typeof config.system_prompt === "string"
        ? config.system_prompt.trim()
        : "";

    if (!systemPrompt) {
      return sendError(res, 400, "Add agent instructions and save first.");
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return sendError(res, 503, "Gemini API is not configured.");
    }

    const model = [
      "gemini-2.5-flash",
      "gemini-2.5-pro"
    ].includes(config.model)
      ? config.model
      : "gemini-2.5-flash";

    const languages = {
      en: "Reply in English.",
      hi: "Reply in Hindi.",
      gu: "Reply in Gujarati."
    };

    const usage = await checkAndUseAI(user, "agents");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: [
                systemPrompt,
                languages[config.language] || languages.en
              ].join("\n\n")
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: message }]
          }],
          generationConfig: {
            temperature: Math.max(
              0,
              Math.min(1, Number(config.temperature ?? 0.5))
            ),
            maxOutputTokens: 1024
          }
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Gemini request failed:",
        response.status,
        JSON.stringify(result).slice(0, 300)
      );

      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        "Gemini request failed. Check API access and quota."
      );
    }

    const reply = (result.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return sendError(res, 502, "Gemini returned an empty response.");
    }

    return sendSuccess(res, {
      reply,
      agent_id: agent.id,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Agent chat error:", error?.message || error);

    return sendError(
      res,
      error?.name === "TimeoutError" ? 504 : 500,
      "Agent chat failed."
    );
  }
}
