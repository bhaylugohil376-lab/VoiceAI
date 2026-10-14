import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    const prompt = typeof body?.prompt === "string"
      ? body.prompt.trim()
      : "";

    if (!prompt) {
      return sendError(res, 400, "Please enter a prompt.");
    }

    if (prompt.length > 12000) {
      return sendError(res, 400, "Prompt is too long. Maximum is 12000 characters.");
    }

    if (!process.env.GEMINI_API_KEY) {
      return sendError(res, 503, "Gemini API is not configured yet.");
    }

    const usage = await checkAndUseAI(user, "assistant");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", result?.error?.message || response.status);
      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        "Gemini could not generate a response. Check your API configuration or quota."
      );
    }

    const text = (result?.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return sendError(res, 502, "Gemini returned an empty response.");
    }

    return sendSuccess(res, {
      text,
      model: MODEL,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Generate API error:", error?.message || error);
    return sendError(res, 500, "Something went wrong while generating text.");
  }
}
