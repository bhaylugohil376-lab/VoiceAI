import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";
import { supabaseAdmin } from "./_lib/supabase.js";

const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 12000;
const MAX_VOICE_ID_LENGTH = 150;

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST", "DELETE"])) {
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Agent list error:", error.message);
        return sendError(res, 500, "Could not load your agents.");
      }

      return sendSuccess(res, { agents: data || [] });
    }

    const body = parseJsonBody(req);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendError(res, 400, "Invalid request body.");
    }

    if (req.method === "POST") {
      const name =
        typeof body.name === "string" ? body.name.trim() : "";

      const instructions =
        typeof body.instructions === "string"
          ? body.instructions.trim()
          : "";

      const voiceId =
        typeof body.voice_id === "string"
          ? body.voice_id.trim()
          : null;

      if (!name || name.length > MAX_NAME_LENGTH) {
        return sendError(
          res,
          400,
          `Agent name is required and must be at most ${MAX_NAME_LENGTH} characters.`
        );
      }

      if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
        return sendError(res, 400, "Agent instructions are too long.");
      }

      if (
        voiceId &&
        !/^[A-Za-z0-9_-]{1,150}$/.test(voiceId)
      ) {
        return sendError(res, 400, "Invalid voice ID.");
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
          user_id: user.id,
          name,
          instructions,
          voice_id: voiceId
        })
        .select("*")
        .single();

      if (error) {
        console.error("Agent create error:", error.message);
        return sendError(res, 500, "Could not create the agent.");
      }

      return res.status(201).json({
        success: true,
        agent: data
      });
    }

    const agentId =
      typeof body.id === "string" || typeof body.id === "number"
        ? String(body.id).trim()
        : "";

    if (!agentId || agentId.length > 100) {
      return sendError(res, 400, "A valid agent ID is required.");
    }

    const { data, error } = await supabaseAdmin
      .from("agents")
      .delete()
      .eq("id", agentId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Agent delete error:", error.message);
      return sendError(res, 500, "Could not delete the agent.");
    }

    if (!data) {
      return sendError(res, 404, "Agent not found.");
    }

    return sendSuccess(res, {
      deleted: true,
      id: data.id
    });
  } catch (error) {
    console.error("Agents API error:", error?.message || error);
    return sendError(res, 500, "Internal server error.");
  }
}
