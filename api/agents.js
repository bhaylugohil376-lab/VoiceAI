
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";
import { supabaseAdmin } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select(
          "id, name, description, type, config, status, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Agent list failed:", error.message);
        return sendError(res, 500, "Could not load agents.");
      }

      return sendSuccess(res, { agents: data || [] });
    }

    const body = parseJsonBody(req);
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description =
      typeof body?.description === "string" ? body.description.trim() : "";

    const systemPrompt =
      typeof body?.system_prompt === "string"
        ? body.system_prompt.trim()
        : "";

    const voiceId =
      typeof body?.voice_id === "string" ? body.voice_id.trim() : "";

    const language =
      typeof body?.language === "string" ? body.language.trim() : "en";

    const model =
      typeof body?.model === "string" ? body.model.trim() : "gemini-2.5-flash";

    if (!name || name.length > 120) {
      return sendError(res, 400, "Agent name is required (max 120 characters).");
    }

    if (description.length > 2000 || systemPrompt.length > 12000) {
      return sendError(res, 400, "Agent description or instructions are too long.");
    }

    if (!["en", "hi", "gu"].includes(language)) {
      return sendError(res, 400, "Unsupported language.");
    }

    if (!["gemini-2.5-flash", "gemini-2.5-pro"].includes(model)) {
      return sendError(res, 400, "Unsupported model.");
    }

    const configPatch = {
      system_prompt: systemPrompt,
      voice_id: voiceId,
      language,
      model,
      temperature: Math.max(
        0,
        Math.min(1, Number(body?.temperature ?? 0.7) || 0)
      ),
      allow_interruptions: body?.allow_interruptions !== false,
      memory_enabled: body?.memory_enabled !== false,
      end_call_detection: body?.end_call_detection !== false,
      welcome_message:
        typeof body?.welcome_message === "string"
          ? body.welcome_message.trim().slice(0, 1000)
          : ""
    };

    if (id) {
      if (id.length > 100) {
        return sendError(res, 400, "Invalid agent ID.");
      }

      const { data: existing, error: findError } = await supabaseAdmin
        .from("agents")
        .select("id, config, status")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (findError) {
        console.error("Agent lookup failed:", findError.message);
        return sendError(res, 500, "Could not load this agent.");
      }

      if (!existing) {
        return sendError(res, 404, "Agent not found.");
      }

      const oldConfig =
        existing.config && typeof existing.config === "object"
          ? existing.config
          : {};

      const { data, error } = await supabaseAdmin
        .from("agents")
        .update({
          name,
          description,
          config: { ...oldConfig, ...configPatch },
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id, name, description, type, config, status, updated_at")
        .single();

      if (error) {
        console.error("Agent update failed:", error.message);
        return sendError(res, 500, "Could not save agent changes.");
      }

      return sendSuccess(res, { agent: data });
    }

    const { data, error } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: user.id,
        name,
        description,
        type: "voice",
        config: configPatch,
        status: "draft"
      })
      .select("id, name, description, type, config, status, created_at")
      .single();

    if (error) {
      console.error("Agent creation failed:", error.message);
      return sendError(res, 500, "Could not create agent.");
    }

    return sendSuccess(res, { agent: data }, 201);
  } catch (error) {
    console.error("Agents API error:", error?.message || error);
    return sendError(res, 500, "Agent request failed.");
  }
}
