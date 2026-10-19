
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

// Stripe webhook ko raw body chahiye signature verify karne ke liye.
const stripeWebhook = (await import("./api/stripe-webhook.js")).default;

app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  (req, res, next) =>
    Promise.resolve(stripeWebhook(req, res)).catch(next)
);

// Normal API requests
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Load API handlers from api/*.js
const apiFiles = [
  "voices",
  "tts"
];

for (const name of apiFiles) {
  const mod = await import(`./api/${name}.js`);
  const handler = mod.default;

  if (typeof handler !== "function") {
    throw new TypeError(`API handler is not a function: ${name}`);
  }

  app.all(`/api/${name}`, (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  });
}

// Static website files
app.use(express.static(__dirname, { index: "index.html" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      error: "API endpoint not found."
    });
  }

  res.sendFile(path.join(__dirname, "index.html"), (error) => {
    if (error) next(error);
  });
});

// Central error handler
app.use((error, _req, res, _next) => {
  console.error("Server error:", error?.message || error);

  if (res.headersSent) return;

  res.status(error?.status || 500).json({
    success: false,
    error: "Internal server error."
  });
});

app.listen(port, () => {
  console.log(`VoiceAI server running on port ${port}`);
});
