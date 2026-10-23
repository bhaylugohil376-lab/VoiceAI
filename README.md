VoiceAI — AI Voice Studio
Production-oriented multi-page AI voice SaaS with separate HTML, CSS and JavaScript files, a Node.js/Express API server, Supabase authentication/database, ElevenLabs TTS/voice features and Stripe billing hooks.
Important production setup
The source code does not contain private provider secrets. For the non-Vercel deployment, create a Render Web Service from this repository (the included `render.yaml` defines the Node service), then add the required values in Render → Environment. Never commit real secrets:
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ELEVENLABS_API_KEY
GEMINI_API_KEY and GEMINI_IMAGE_MODEL (image generation)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PREMIUM_MONTHLY_PRICE_ID
STRIPE_PREMIUM_YEARLY_PRICE_ID
APP_URL

MUSIC_API_URL / MUSIC_API_KEY (if Music provider is enabled)
SOUND_EFFECTS_API_URL / SOUND_EFFECTS_API_KEY (if SFX provider is enabled)
See .env.example for names only. Never commit real secret values.
Free accounts receive up to five uses for each AI tool in a rolling 24-hour window. Usage is enforced by the server-side Supabase RPC, and the usage page reads action counts from usage_logs.
Supabase usage-limit migration
Run `supabase/profiles.sql` first, then `supabase/usage_limits.sql` in the Supabase SQL Editor before production use. The first migration creates the profile table and a signup trigger that creates a Free profile for new accounts. The browser uses the publishable key in `supabase-config.js`; the backend needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as backend environment variables. Never expose the service-role key in browser code or commit it.
It changes Free usage to 5 uses per 24-hour window per AI section/action. TTS, Clone, STT, Image, Music, SFX, Agents, etc. have independent counters. Premium/Admin are unlimited at the application level.
Deployment
**Render (no Vercel):** connect this GitHub repository and deploy the included `render.yaml` as a Web Service. Render should run `npm install` and `npm start`; set the required environment variables in the Render dashboard. The Node server serves both the site and `/api/*` endpoints on the same origin. If you keep GitHub Pages as the frontend, set `window.VOICEAI_API_BASE_URL` to your deployed Render service URL before `api-config.js` loads. A Render URL is created by Render at deployment time and cannot be pre-filled safely here. 

Media-provider notes
TTS, STT, voice cloning, dubbing and image generation are wired to their server APIs. Music and Sound Effects use configurable provider endpoints. Studio export and Video Voice Transfer create authenticated jobs/queues; a real production media worker/provider is required to render the final media file.
Security
Provider API keys stay server-side.
Browser uses Supabase publishable key only.
Authenticated APIs validate the Supabase bearer token.
Agent deletion verifies ownership.
AI usage enforcement is server-side through Supabase RPC.
Large voice library
The Voices page is designed for a large real voice library. It loads voices from Supabase in pages rather than loading thousands of records into the browser at once.
To sync up to 10,000 real ElevenLabs voices into Supabase, configure ELEVENLABS_API_KEY and VOICE_SYNC_SECRET, run supabase/voices_library.sql, then POST to /api/voices/sync with:
{"max_voices":10000}
Use the Authorization: Bearer <VOICE_SYNC_SECRET> header. The sync endpoint follows ElevenLabs v2 voice pagination using has_more and next_page_token. It never invents placeholder voices. Provider availability and account permissions determine how many real voices can actually be synced.


API verification scope
`npm test` runs repository syntax/required-file checks plus static media-provider contract checks. These checks do not make live paid API calls and do not prove provider credentials are valid. Music and Sound Effects expect provider endpoints to return JSON with `audio_url`/`url` or `job_id`/`id`; asynchronous jobs need provider-specific polling. Dubbing still requires an adapter that matches the selected provider's documented upload and response contract. Configure real keys only in deployment environment variables; never commit secrets.
