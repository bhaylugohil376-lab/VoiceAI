import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { sendError } from "./_lib/response.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
      return sendError(res, 503, "Gemini API key is not configured");
    }

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    if (!prompt) {
      return sendError(res, 400, "Prompt is required");
    }

    if (prompt.length > 10000) {
      return sendError(res, 400, "Prompt is too long");
    }

    const usage = await checkAndUseAI(user, "assistant");

    if (usage?.allowed === false) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached"
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
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
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        (await response.text()).slice(0, 300)
      );

      return sendError(
        res,
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "Gemini rate limit reached"
          : "Text generation failed"
      );
    }

    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return sendError(res, 502, "No text was generated");
    }

    return res.status(200).json({
      success: true,
      text,
      model,
      remaining: usage?.remaining ?? null
    });
  } catch (error) {
    console.error("Generate route error:", error.message);

    return sendError(
      res,
      error.name === "TimeoutError" ? 504 : 500,
      error.name === "TimeoutError"
        ? "Generation timed out"
        : "Internal server error"
    );
  }
}
