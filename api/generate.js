import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_PROMPT_LENGTH = 12000;
const REQUEST_TIMEOUT_MS = 60000;

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = parseJsonBody(req);
    const prompt =
      typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return sendError(res, 400, "Please enter a prompt.");
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return sendError(
        res,
        400,
        `Prompt is too long. Maximum is ${MAX_PROMPT_LENGTH} characters.`
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return sendError(res, 503, "Gemini API is not configured yet.");
    }

    const baseUrl = (
      process.env.GEMINI_API_URL ||
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");

    const usage = await checkAndUseAI(user, "assistant");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    let response;
    let actualModel = MODEL;

    try {
      response = await fetch(
        `${baseUrl}/models/${encodeURIComponent(MODEL)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
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
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    // Recover if a configured Gemini model is no longer available.
    if (!response.ok && response.status === 404 && MODEL !== "gemini-2.5-flash") {
      actualModel = "gemini-2.5-flash";
      response = await fetch(
        `${baseUrl}/models/${encodeURIComponent(actualModel)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }
      );
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "");

      console.error(
        "Gemini generate request failed:",
        response.status,
        details.slice(0, 400)
      );

      if (response.status === 429) {
        return sendError(
          res,
          429,
          "Gemini rate limit or quota reached. Please try again later."
        );
      }

      return sendError(
        res,
        502,
        "Gemini could not generate a response. Check the model, API key, and quota."
      );
    }

    const result = await response.json();

    const text = (result?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return sendError(
        res,
        502,
        "Gemini returned no text. The prompt may have been blocked or no candidate was generated."
      );
    }

    return sendSuccess(res, {
      text,
      model: actualModel,
      remaining: usage.remaining
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return sendError(res, 504, "Gemini request timed out. Please try again.");
    }

    console.error("Generate API error:", error?.message || error);

    return sendError(
      res,
      500,
      "Something went wrong while generating text."
    );
  }
}
