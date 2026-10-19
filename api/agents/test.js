import { requireMethod, sendError } from "../_lib/response.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;
  return sendError(res, 501, "Live voice-agent sessions are unavailable because the ElevenLabs provider has been removed.");
}
