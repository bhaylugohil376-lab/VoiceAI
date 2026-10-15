
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

  const requiredConfigured = Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!requiredConfigured) {
    return res.status(503).json({
      success: false,
      status: "degraded",
      message: "Required server configuration is missing."
    });
  }

  return res.status(200).json({
    success: true,
    status: "running",
    timestamp: new Date().toISOString(),
    environment:
      process.env.VERCEL_ENV === "production"
        ? "production"
        : "non-production",
    message: "VoiceAI API is running."
  });
}
