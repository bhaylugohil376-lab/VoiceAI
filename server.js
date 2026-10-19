
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Stripe webhook must receive the raw body for signature verification.
// Keep this route before express.json().
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const { default: handler } = await import(
        "./api/stripe-webhook.js"
      );

      return await handler(req, res);
    } catch (error) {
      console.error("Stripe webhook error:", error.message);

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Stripe webhook processing failed."
        });
      }
    }
  }
);

// Standard API request parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Voice API routes (CommonJS)
app.use("/api/voices", require("./api/voices"));
app.use("/api/tts", require("./api/tts"));

// Static frontend
app.use(express.static(path.join(__dirname, ".")));

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok"
  });
});

// Frontend fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`VoiceAI server running on port ${port}`);
});
