
import { requireUser } from "../_lib/auth.js";
import { checkAndUseAI } from "../_lib/usage.js";
import { requireMethod, sendError } from "../_lib/response.js";
import { supabaseAdmin } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const fallbackModel = "gemini-2.5-flash-image";
    const baseUrl = (
      process.env.GEMINI_API_URL ||
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");

    if (!apiKey || !model) {
      return sendError(res, 503, "Gemini image generation is not configured.");
    }

    const body = req.body && typeof req.body === "object"
      ? req.body
      : {};

    const prompt = typeof body.prompt === "string"
      ? body.prompt.trim()
      : "";

    if (!prompt) {
      return sendError(res, 400, "Please enter an image prompt.");
    }

    if (prompt.length > 4000) {
      return sendError(res, 400, "Prompt must be 4,000 characters or fewer.");
    }

    const usage = await checkAndUseAI(user, "image");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Image generation limit reached."
      );
    }

    let actualModel = model;
    let providerResponse = await fetch(
      `${baseUrl}/models/${encodeURIComponent(actualModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseModalities: ["IMAGE"]
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!providerResponse.ok && providerResponse.status === 404 && actualModel !== fallbackModel) {
      actualModel = fallbackModel;
      providerResponse = await fetch(
        `${baseUrl}/models/${encodeURIComponent(actualModel)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] }
          }),
          signal: AbortSignal.timeout(60000)
        }
      );
    }

    if (!providerResponse.ok) {
      const details = await providerResponse.text();
      console.error(
        "Gemini image request failed:",
        providerResponse.status,
        details.slice(0, 400)
      );

      if (providerResponse.status === 429) {
        return sendError(res, 429, "Gemini image quota or rate limit reached.");
      }

      return sendError(
        res,
        502,
        "Image generation failed. Check that the configured Gemini model supports image output."
      );
    }

    const result = await providerResponse.json();
    const parts = result.candidates?.[0]?.content?.parts || [];

    const generatedImage = parts.find(
      (part) => part.inlineData?.data || part.inline_data?.data
    );

    if (!generatedImage) {
      return sendError(res, 502, "Gemini did not return an image.");
    }

    const imageData =
      generatedImage.inlineData || generatedImage.inline_data;

    const mimeType = imageData.mimeType || imageData.mime_type || "image/png";

    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
      return sendError(res, 502, "Gemini returned an unsupported image format.");
    }

    const imageBase64 = imageData.data;
    const imageBuffer = Buffer.from(imageBase64, "base64");

    if (!imageBuffer.length || imageBuffer.length > 10 * 1024 * 1024) {
      return sendError(res, 502, "Generated image is empty or too large.");
    }

    // Store metadata only. Use private storage for image bytes if persistence is needed.
    const { error: saveError } = await supabaseAdmin
      .from("image_generations")
      .insert({
        user_id: user.id,
        prompt,
        model: actualModel,
        status: "completed"
      });

    if (saveError) {
      console.error("Image metadata save failed:", saveError.message);
    }

    return res.status(200).json({
      success: true,
      image: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
      mime_type: mimeType,
      model: actualModel,
      remaining: usage.remaining
    });
  } catch (error) {
    console.error("Image API error:", error.message);
    return sendError(res, 500, "Unexpected image generation error.");
  }
}
