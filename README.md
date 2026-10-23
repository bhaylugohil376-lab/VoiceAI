# VoiceAI — AI Voice Studio

Static multi-page VoiceAI frontend with Supabase authentication/database and Supabase Edge Functions for supported voice endpoints.

## Supabase setup

The frontend routes these API paths to the Supabase project configured in `api-config.js`:

- `/api/health` → `voiceai-health`
- `/api/voices` → `voiceai-voices`
- `/api/tts` → `voiceai-tts`

Set these secrets in Supabase Dashboard → Edge Functions → Secrets. Do not put private keys in browser code or commit them:

- `ELEVENLABS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The Edge Functions validate the Supabase access token before requesting voice data or generating audio. The browser must send the signed-in user's Supabase access token as a Bearer token.

## Important migration status

Only health, voices, and text-to-speech are currently routed to Supabase Edge Functions. Other existing endpoints under `server/api/` are still Node/Vercel-style handlers and have **not** all been migrated to Edge Functions yet. Do not remove the old backend files until each endpoint has a tested Supabase replacement.

TTS production readiness also requires server-side usage-limit enforcement in the Edge Function. Test provider credentials, CORS, signed-in voice listing, and audio generation before treating the service as production-ready.

## Security

- Keep ElevenLabs and any service-role/secret keys server-side in Supabase Secrets.
- Never expose a Supabase service-role key in browser JavaScript.
- Never commit API secrets to GitHub.
- Do not claim a provider is connected until a live authenticated request succeeds.
