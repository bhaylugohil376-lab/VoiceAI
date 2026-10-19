import express from "express";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const ROOT = __dirname;
const API_DIR = path.join(ROOT, "api");

// Stripe requires the untouched request body for signature verification.
// This route must be registered before JSON parsing.
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    try {
      const { default: handler } = await import("./api/stripe-webhook.js");
      return await handler(req, res);
    } catch (error) {
      console.error("Stripe webhook error:", error);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Stripe webhook processing failed."
        });
      }
    }
  }
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API files are ESM handlers (export default), not Express routers.
// Dispatch /api/foo/bar to api/foo/bar.js so local development uses the
// same handler contract as serverless deployments.
app.all("/api/*", async (req, res, next) => {
  const requestedPath = (req.path || "").replace(/^\/api\/?/, "");
  const segments = requestedPath.split("/").filter(Boolean);

  if (
    !segments.length ||
    segments.some((segment) => segment.startsWith(".") || segment.includes("\\"))
  ) {
    return res.status(404).json({ success: false, error: "API route not found." });
  }

  const handlerPath = path.resolve(API_DIR, ...segments) + ".js";
  if (!handlerPath.startsWith(API_DIR + path.sep)) {
    return res.status(404).json({ success: false, error: "API route not found." });
  }

  try {
    await fs.promises.access(handlerPath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ success: false, error: "API route not found." });
  }

  try {
    const moduleUrl = pathToFileURL(handlerPath).href;
    const { default: handler } = await import(moduleUrl);
    if (typeof handler !== "function") {
      return res.status(500).json({ success: false, error: "API handler is invalid." });
    }
    return await handler(req, res);
  } catch (error) {
    console.error(`API handler failed for ${req.method} ${req.path}:`, error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "API request failed."
      });
    }
  }
});

// Static frontend
app.use(express.static(ROOT, { extensions: ["html"] }));

app.get("*", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.listen(port, () => {
  console.log(`VoiceAI server running on port ${port}`);
});

export default app;
