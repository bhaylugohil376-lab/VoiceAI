
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const baseUrl = (
      process.env.GEMINI_API_URL ||
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");

    if (!apiKey) {
      return sendError(res, 503, "Gemini API is not configured.");
    }

    const body = req.body && typeof req.body === "object"
      ? req.body
      : {};

    const message = typeof body.message === "string"
      ? body.message.trim()
      : "";

    if (!message) {
      return sendError(res, 400, "Please enter a message.");
    }

    if (message.length > 10000) {
      return sendError(res, 400, "Message must be 10,000 characters or fewer.");
    }

    const usage = await checkAndUseAI(user, "assistant");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Assistant usage limit reached."
      );
    }

    const response = await fetch(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
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
              parts: [{ text: message }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        }),
        signal: AbortSignal.timeout(55000)
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error(
        "Gemini request failed:",
        response.status,
        details.slice(0, 400)
      );

      if (response.status === 429) {
        return sendError(res, 429, "Gemini rate limit or quota reached.");
      }

      return sendError(res, 502, "Gemini could not generate a response.");
    }

    const result = await response.json();

    const reply = (result.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return sendError(res, 502, "Gemini returned an empty response.");
    }

    return res.status(200).json({
      success: true,
      reply,
      model,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Assistant API error:", error?.message || error);

    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return sendError(res, 504, "Gemini timed out. Please try again.");
    }

    return sendError(res, 502, "Assistant request failed. Please try again.");
  }
}
