
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function providerError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function transferVideo({
  providerUrl,
  providerKey,
  videoBuffer,
  originalFilename,
  mimeType,
  fields
}) {
  if (!providerUrl || !isHttpsUrl(providerUrl) || !providerKey) {
    throw providerError("Video provider is not configured.", 503);
  }

  if (!Buffer.isBuffer(videoBuffer) || videoBuffer.length === 0) {
    throw providerError("The uploaded video is empty.", 400);
  }

  const form = new FormData();

  form.append(
    "file",
    new Blob([videoBuffer], {
      type: mimeType || "application/octet-stream"
    }),
    originalFilename || "upload.mp4"
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
      signal: AbortSignal.timeout(180000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" ||
        error?.name === "AbortError") {
      throw providerError("Video processing timed out.", 504);
    }

    throw providerError("Could not reach the video provider.", 502);
  }

  if (!response.ok) {
    // Do not send provider error details or secrets to the browser.
    await response.text().catch(() => "");

    if (response.status === 429) {
      throw providerError("The video provider quota is exhausted or busy.", 429);
    }

    if (response.status === 401 || response.status === 403) {
      throw providerError("The video provider rejected its API credentials.", 502);
    }

    throw providerError("The video provider could not process this video.", 502);
  }

  const contentType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();

  if (contentType.startsWith("video/")) {
    const outputBuffer = Buffer.from(await response.arrayBuffer());

    if (!outputBuffer.length || outputBuffer.length > MAX_OUTPUT_BYTES) {
      throw providerError("The provider returned an empty or oversized video.");
    }

    return {
      base64: outputBuffer.toString("base64"),
      fileName: "voiceai-voice-transfer.mp4",
      title: "Transformed Video"
    };
  }

  let result;

  try {
    result = await response.json();
  } catch {
    throw providerError("The provider returned an unsupported response.");
  }

  const outputUrl =
    result.outputUrl || result.videoUrl || result.url;

  if (typeof outputUrl === "string" && outputUrl.trim()) {
    if (!isHttpsUrl(outputUrl)) {
      throw providerError("The provider returned an invalid video URL.");
    }

    return {
      outputUrl,
      fileName: result.fileName || "voiceai-voice-transfer.mp4",
      title: result.title || "Transformed Video"
    };
  }

  if (typeof result.base64 === "string" && result.base64.length > 0) {
    const encoded = result.base64.replace(/\s/g, "");

    if (
      encoded.length > Math.ceil(MAX_OUTPUT_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) {
      throw providerError("The provider returned invalid or oversized video data.");
    }

    const outputBuffer = Buffer.from(encoded, "base64");

    if (!outputBuffer.length || outputBuffer.length > MAX_OUTPUT_BYTES) {
      throw providerError("The provider returned an empty or oversized video.");
    }

    return {
      base64: outputBuffer.toString("base64"),
      fileName: result.fileName || "voiceai-voice-transfer.mp4",
      title: result.title || "Transformed Video"
    };
  }

  throw providerError(
    "The provider must return a hosted video URL or base64 video."
  );
}
