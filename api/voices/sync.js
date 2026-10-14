import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "../_lib/supabase.js";
import { requireMethod, sendError, sendSuccess } from "../_lib/response.js";

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  const expectedSecret = process.env.VOICE_SYNC_SECRET;
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!expectedSecret || !match || !safeEqual(match[1].trim(), expectedSecret)) {
    return sendError(res, 401, "Voice sync authorization failed.");
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return sendError(res, 503, "Voice provider is not configured.");
  }

  const requestedMax = Number(req.body?.max_voices ?? 1000);
  const maxVoices = Number.isFinite(requestedMax)
    ? Math.min(10000, Math.max(1, Math.floor(requestedMax)))
    : 1000;

  let nextPageToken = null;
  let synced = 0;
  let pages = 0;

  try {
    while (synced < maxVoices) {
      const url = new URL("https://api.elevenlabs.io/v2/voices");
      url.searchParams.set("page_size", String(Math.min(100, maxVoices - synced)));

      if (nextPageToken) {
        url.searchParams.set("next_page_token", nextPageToken);
      }

      const response = await fetch(url, {
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        console.error("ElevenLabs voice sync failed:", response.status);
        return sendError(res, 502, "Could not retrieve the voice library.");
      }

      const result = await response.json();
      const voices = Array.isArray(result.voices) ? result.voices : [];

      const rows = voices
        .filter(voice => voice.voice_id && voice.name)
        .map(voice => ({
          voice_id: voice.voice_id,
          provider: "elevenlabs",
          name: voice.name,
          category: voice.category || null,
          description: voice.description || null,
          preview_url: voice.preview_url || null,
          labels: voice.labels || {},
          available_for_tts: true
        }));

      if (rows.length) {
        const { error } = await supabaseAdmin
          .from("voices_library")
          .upsert(rows, { onConflict: "provider,voice_id" });

        if (error) {
          console.error("Voice library upsert failed:", error.message);
          return sendError(res, 500, "Could not save the voice library.");
        }

        synced += rows.length;
      }

      pages += 1;

      if (!result.has_more || !result.next_page_token || !voices.length) {
        break;
      }

      nextPageToken = result.next_page_token;

      if (pages >= 200) break;
    }

    return sendSuccess(res, {
      synced,
      pages,
      max_voices: maxVoices,
      message: "Voice sync completed."
    });
  } catch (error) {
    console.error("Voice sync error:", error.message);

    return sendError(
      res,
      error.name === "TimeoutError" ? 504 : 500,
      error.name === "TimeoutError"
        ? "Voice sync timed out."
        : "Voice sync failed."
    );
  }
}
