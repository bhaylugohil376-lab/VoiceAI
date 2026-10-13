
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sends the validated video and settings to your configured
 * video voice-transfer provider.
 *
 * Provider contract: accepts multipart/form-data and returns
 * a hosted video URL, JSON with a video URL, or a video response.
 */
export async function transferVideo({
  providerUrl,
  providerKey,
  videoBuffer,
  originalFilename,
  mimeType,
  fields
}) {
  if (!providerUrl || !isHttpsUrl(providerUrl) || !providerKey) {
    throw new Error("Video transfer provider is not configured.");
  }

  if (!videoBuffer?.length) {
    throw new Error("Uploaded video is empty.");
  }

  const form = new FormData();

  form.append(
    "file",
    new Blob([videoBuffer], {
      type: mimeType || "application/octet-stream"
    }),
    originalFilename || "input-video.mp4"
  );

  for (const [key, value] of Object.entries(fields || {})) {
    form.append(key, String(value));
  }

  let response;

  try {
    response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerKey}`,
        "x-api-key": providerKey,
        Accept: "application/json, video/*"
      },
      body: form,
      signal: AbortSignal.timeout(55000)
    });
  } catch (error) {
    console.error("Video provider connection failed:", error.message);
    throw new Error("Video provider could not be reached.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      "Video provider error:",
      response.status,
      detail.slice(0, 300)
    );

    throw new Error(
      response.status === 429
        ? "Video provider quota reached or service is busy."
        : "Video provider failed to process the video."
    );
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.toLowerCase().startsWith("video/")) {
    const output = Buffer.from(await response.arrayBuffer());

    if (!output.length || output.length > MAX_OUTPUT_BYTES) {
      throw new Error("Provider video output is empty or too large.");
    }

    return {
      base64: output.toString("base64"),
      fileName: "voiceai-voice-transfer.mp4",
      title: "Transformed Video"
    };
  }

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Provider returned an invalid response.");
  }

  const outputUrl =
    result.outputUrl ||
    result.videoUrl ||
    result.url ||
    result.data?.outputUrl ||
    result.data?.videoUrl ||
    result.data?.url;

  if (typeof outputUrl === "string" && isHttpsUrl(outputUrl)) {
    return {
      outputUrl,
      fileName: result.fileName || "voiceai-voice-transfer.mp4",
      title: result.title || "Transformed Video"
    };
  }

  const base64 = result.base64 || result.data?.base64;

  if (
    typeof base64 === "string" &&
    base64.length > 0 &&
    base64.length <= 28 * 1024 * 1024 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    return {
      base64,
      fileName: result.fileName || "voiceai-voice-transfer.mp4",
      title: result.title || "Transformed Video"
    };
  }

  throw new Error(
    "Provider response must contain a hosted video URL or base64 video."
  );
}
