VoiceAI — AI Voice Studio
Production-oriented multi-page AI voice SaaS starter with separate HTML, CSS and JavaScript files, Vercel serverless APIs, Supabase authentication/database, ElevenLabs TTS/voice features and Stripe billing hooks.
Important production setup
The source code does not contain private provider secrets. Add these in Vercel Project Settings → Environment Variables:
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ELEVENLABS_API_KEY
OPENAI_API_KEY (image generation)
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
Run supabase/usage_limits.sql in the Supabase SQL Editor before production use.
It changes Free usage to 5 uses per 24-hour window per AI section/action. TTS, Clone, STT, Image, Music, SFX, Agents, etc. have independent counters. Premium/Admin are unlimited at the application level.
Deployment
The included vercel.json intentionally does not declare a legacy/invalid Node runtime. Vercel detects the Node.js runtime for /api functions.
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
