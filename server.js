require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;

app.disable("x-powered-by");

// Block private files from public access.
app.use((req, res, next) => {
  let pathname;

  try {
    pathname = decodeURIComponent(req.path || "/").replace(/\\/g, "/");
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const blocked =
    pathname === "/.env" ||
    pathname.startsWith("/.env.") ||
    pathname === "/package.json" ||
    pathname === "/package-lock.json" ||
    pathname === "/server.js" ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/.git/");

  if (blocked) {
    return res.status(404).json({ error: "Not found" });
  }

  next();
});

// Stripe webhook must receive the original raw body.
// Register this BEFORE express.json().
app.post(
  "/api/stripe-webhook",
  express.raw({
    type: "application/json",
    limit: "1mb"
  }),
  async (req, res, next) => {
    try {
      const stripeModule = await import(
        path.join(ROOT_DIR, "api", "stripe-webhook.js")
      );

      const handler = stripeModule.default;

      if (typeof handler !== "function") {
        return res.status(500).json({
          error: "Stripe webhook handler unavailable"
        });
      }

      await handler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Parse JSON for the other routes.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Load API handlers, supporting CommonJS and ES Module exports.
function mountHandler(route, file) {
  app.all(route, async (req, res, next) => {
    try {
      const modulePath = path.join(ROOT_DIR, file);
      const loaded = await import(modulePath);

      const handler =
        typeof loaded.default === "function"
          ? loaded.default
          : typeof loaded.handler === "function"
            ? loaded.handler
            : null;

      if (!handler) {
        return res.status(500).json({
          error: `Invalid API handler: ${route}`
        });
      }

      await handler(req, res);
    } catch (error) {
      next(error);
    }
  });
}

mountHandler("/api/voices", "api/voices.js");
mountHandler("/api/tts", "api/tts.js");

// Mount health endpoint only if the file exists.
if (fs.existsSync(path.join(ROOT_DIR, "api", "health.js"))) {
  mountHandler("/api/health", "api/health.js");
}

// Unknown API endpoints return JSON.
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found",
    support: "bhaylugohil376@gmail.com"
  });
});

// Serve frontend files.
app.use(express.static(ROOT_DIR, {
  dotfiles: "deny",
  index: "index.html",
  extensions: ["html"]
}));

// Frontend fallback.
app.get("*", (req, res, next) => {
  const indexPath = path.join(ROOT_DIR, "index.html");

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("Frontend index.html not found");
  }

  res.sendFile(indexPath, error => {
    if (error) next(error);
  });
});

// Central error handler.
app.use((error, req, res, next) => {
  console.error("Server error:", error.stack || error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Internal server error",
    support: "bhaylugohil376@gmail.com"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VoiceAI server running on port ${PORT}`);
});
