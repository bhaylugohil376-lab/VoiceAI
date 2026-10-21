import { getSupabaseAdmin } from "./_lib/supabase.js";
import { sendError, sendSuccess, requireMethod, parseJsonBody } from "./_lib/response.js";

const PAGE_SIZE = 100;
const MAX_VOICES = 10000;

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  const expectedSecret = process.env.VOICE_SYNC_SECRET;
  const authorization = String(req.headers?.authorization || "");
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return sendError(res, 401, "Voice library sync is not authorized.");
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return sendError(res, 503, "ElevenLabs is not configured.");

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (error) {
    return sendError(res, 503, "Supabase service role is not configured.");
  }

  const body = parseJsonBody(req) || {};
  const requested = Number(body.max_voices ?? MAX_VOICES);
  const maxVoices = Number.isInteger(requested)
    ? Math.max(1, Math.min(requested, MAX_VOICES))
    : MAX_VOICES;

  let nextPageToken = "";
  let synced = 0;
  let pages = 0;

  try {
    while (synced < maxVoices) {
      const params = new URLSearchParams({
        page_size: String(Math.min(PAGE_SIZE, maxVoices - synced)),
        include_total_count: "true"
      });
      if (nextPageToken) params.set("next_page_token", nextPageToken);

      const response = await fetch(
        "https://api.elevenlabs.io/v2/voices?" + params.toString(),
        {
          headers: { "xi-api-key": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(25000)
        }
      );

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        console.error("Voice sync provider error:", response.status, details.slice(0, 400));
        return sendError(res, 502, "ElevenLabs could not provide the voice catalogue.");
      }

      const payload = await response.json();
      const voices = Array.isArray(payload.voices) ? payload.voices : [];
      if (!voices.length) break;

      const rows = voices
        .filter(voice => typeof voice.voice_id === "string" && voice.voice_id && typeof voice.name === "string" && voice.name)
        .map(voice => ({
          provider: "elevenlabs",
          voice_id: voice.voice_id,
          name: voice.name,
          category: voice.category || null,
          description: voice.description || null,
          preview_url: voice.preview_url || null,
          labels: voice.labels && typeof voice.labels === "object" ? voice.labels : {},
          available_for_tts: true
        }));

      if (rows.length) {
        const { error } = await admin
          .from("voices_library")
          .upsert(rows, { onConflict: "provider,voice_id" });
        if (error) {
          console.error("Voice sync database error:", error.message);
          return sendError(res, 503, "Could not save the voice catalogue to Supabase.");
        }
        synced += rows.length;
      }

      pages += 1;
      nextPageToken = typeof payload.next_page_token === "string" ? payload.next_page_token : "";
      if (!payload.has_more || !nextPageToken || pages >= Math.ceil(MAX_VOICES / PAGE_SIZE)) break;
    }

    return sendSuccess(res, {
      synced,
      pages,
      max_voices: maxVoices,
      message: "Real ElevenLabs voice metadata synced to Supabase."
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return sendError(res, 504, "Voice catalogue sync timed out. Try again.");
    }
    console.error("Voice sync error:", error?.message || error);
    return sendError(res, 500, "Voice catalogue sync failed.");
  }
}
