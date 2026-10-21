export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  // Liveness must not fail just because optional deployment secrets are absent.
  // Report configuration separately so monitoring can distinguish a running
  // function from a fully configured application without exposing secret values.
  const configuration = {
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    elevenLabsApiKey: Boolean(process.env.ELEVENLABS_API_KEY),
    geminiApiKey: Boolean(process.env.GEMINI_API_KEY),
    openaiApiKey: Boolean(process.env.OPENAI_API_KEY)
  };

  const supabaseReady =
    configuration.supabaseUrl &&
    configuration.supabaseAnonKey &&
    configuration.supabaseServiceRoleKey;

  return res.status(200).json({
    success: true,
    status: "running",
    readiness: supabaseReady ? "ready" : "degraded",
    timestamp: new Date().toISOString(),
    environment:
      process.env.VERCEL_ENV === "production"
        ? "production"
        : "non-production",
    configuration,
    message: supabaseReady
      ? "VoiceAI API is running and Supabase server configuration is present."
      : "VoiceAI API is running, but required Supabase server configuration is incomplete."
  });
}
