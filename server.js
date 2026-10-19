
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;

app.disable("x-powered-by");

// Protect private configuration and backend source files.
app.use((req, res, next) => {
  let pathname;

  try {
    pathname = decodeURIComponent(req.path || "/")
      .replace(/\\/g, "/");
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const blocked =
    pathname === "/.env" ||
    pathname.startsWith("/.env.") ||
    pathname === "/package.json" ||
    pathname === "/package-lock.json" ||
    pathname === "/server.js" ||
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/.git/");

  if (blocked) {
    return res.status(404).json({ error: "Not found" });
  }

  next();
});

// Stripe needs the original, unparsed request body.
// Keep this route before express.json().
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res, next) => {
    try {
      const module = await import("./api/stripe-webhook.js");
      const handler = module.default;

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

// Parse JSON for other API routes.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Adapt existing serverless-style API handlers to Express.
function mountHandler(route, file) {
  app.all(route, async (req, res, next) => {
    try {
      const loaded = await import(
        pathToFileURL(path.join(ROOT_DIR, file)).href
      );

      const handler =
        typeof loaded.default === "function"
          ? loaded.default
          : typeof loaded === "function"
            ? loaded
            : null;

      if (!handler) {
        return res.status(500).json({
          error: "API handler unavailable"
        });
      }

      await handler(req, res);
    } catch (error) {
      next(error);
    }
  });
}

const { pathToFileURL } = require("url");

// These routes use the existing project API files.
mountHandler("/api/voices", "api/voices.js");
mountHandler("/api/tts", "api/tts.js");
mountHandler("/api/health", "api/health.js");

// Prevent unknown API requests from returning index.html.
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found",
    support: "bhaylugohil376@gmail.com"
  });
});

// Serve public frontend files only.
app.use(express.static(ROOT_DIR, {
  dotfiles: "deny",
  index: "index.html",
  extensions: ["html"]
}));

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
  console.error("Server error:", error.message);

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
