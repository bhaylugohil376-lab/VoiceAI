import { readFileSync, existsSync } from "node:fs";

const tts = readFileSync("api/tts.js", "utf8");
const env = readFileSync(".env.example", "utf8");
const readme = readFileSync("README.md", "utf8");
const checks = [
  ["TTS PCM content type", /outputFormat\.startsWith\("pcm_"\)\s*\?\s*"audio\/pcm"\s*:\s*"audio\/mpeg"/.test(tts)],
  ["Music provider URL documented", /^MUSIC_API_URL=/m.test(env)],
  ["Sound Effects provider URL documented", /^SOUND_EFFECTS_API_URL=/m.test(env)],
  ["Dubbing provider URL documented", /^DUBBING_API_URL=/m.test(env)],
  ["Provider test limitations documented", readme.includes("Provider integration verification")]
];
let failed = false;
for (const [label, ok] of checks) {
  process.stdout.write((ok ? "PASS " : "FAIL ") + label + "\n");
  if (!ok) failed = true;
}
if (failed) process.exit(1);
