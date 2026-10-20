import OpenAI from "openai";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

const MAX_MESSAGE_LENGTH = 10000;

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const provider = typeof body.provider === "string"
      ? body.provider.trim().toLowerCase()
      : "gemini";

    if (!message) return sendError(res, 400, "Please enter a message.");
    if (message.length > MAX_MESSAGE_LENGTH) {
      return sendError(res, 400, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
    }
    if (!["gemini", "openai"].includes(provider)) {
      return sendError(res, 400, "Unsupported provider. Choose gemini or openai.");
    }

    const usage = await checkAndUseAI(user, "assistant");
    if (!usage.allowed) {
      return sendError(res, usage.status || 429, usage.error || "Assistant usage limit reached.");
    }

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return sendError(res, 503, "OpenAI API is not configured.");

      const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
      const openai = new OpenAI({ apiKey, timeout: 60000, maxRetries: 1 });
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: message }],
        temperature: 0.7,
        max_tokens: 2048
      });
      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (!reply) return sendError(res, 502, "OpenAI returned an empty response.");

      return res.status(200).json({
        success: true,
        reply,
        provider: "openai",
        model,
        remaining: usage.remaining
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const baseUrl = (
      process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");

    if (!apiKey) return sendError(res, 503, "Gemini API is not configured.");

    const response = await fetch(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Gemini request failed:", response.status, details.slice(0, 400));
      if (response.status === 429) return sendError(res, 429, "Gemini rate limit or quota reached.");
      return sendError(res, 502, "Gemini could not generate a response.");
    }

    const result = await response.json();
    const reply = (result.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) return sendError(res, 502, "Gemini returned an empty response.");

    return res.status(200).json({
      success: true,
      reply,
      provider: "gemini",
      model,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Assistant API error:", error?.message || error);
    if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") {
      return sendError(res, 504, "AI request timed out. Please try again.");
    }
    if (error?.status === 429) {
      return sendError(res, 429, "AI provider quota or rate limit reached.");
    }
    if (error?.status === 401) {
      return sendError(res, 502, "AI provider rejected the configured API key.");
    }
    return sendError(res, 502, "Unexpected assistant provider error.");
  }
}
