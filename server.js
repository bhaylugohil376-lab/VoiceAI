
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const port = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;

// Do not expose backend source, environment files or dependencies
// through the public static file server.
app.use((req, res, next) => {
  const pathname = decodeURIComponent(
    (req.path || "/").replace(/\\/g, "/")
  );

  const blocked =
    pathname === "/.env" ||
    pathname.startsWith("/.env.") ||
    pathname === "/package.json" ||
    pathname === "/package-lock.json" ||
    pathname === "/server.js" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/.git/");

  if (blocked) {
    return res.status(404).json({ error: "Not found" });
  }

  next();
});

// API body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// API routes must be CommonJS-compatible.
app.use("/api/voices", require("./api/voices"));
app.use("/api/tts", require("./api/tts"));
app.use(
  "/api/stripe-webhook",
  require("./api/stripe-webhook")
);

// Static frontend
app.use(express.static(ROOT_DIR, {
  dotfiles: "deny",
  index: "index.html",
  extensions: ["html"],
}));

// API requests should never fall through to the frontend.
app.use("/api", (req, res) => {
  return res.status(404).json({
    error: "API endpoint not found",
    support: "bhaylugohil376@gmail.com",
  });
});

// Frontend fallback
app.get("*", (req, res, next) => {
  const indexPath = path.join(ROOT_DIR, "index.html");

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("Frontend index.html not found");
  }

  return res.sendFile(indexPath, (error) => {
    if (error) next(error);
  });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Internal server error",
    support: "bhaylugohil376@gmail.com",
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`VoiceAI server listening on port ${port}`);
});
