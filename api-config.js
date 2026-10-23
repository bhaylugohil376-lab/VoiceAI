(function () {
  "use strict";

  // Set this before loading api-config.js when the frontend is hosted separately:
  // window.VOICEAI_API_BASE_URL = "https://your-service.onrender.com";
  // Leave empty when the frontend and API are served by the same Node server.
  if (window.__VOICEAI_API_FETCH_PATCHED__) return;

  const backend = String(window.VOICEAI_API_BASE_URL || "").replace(/\/+$/, "");
  const originalFetch = window.fetch.bind(window);

  function rewriteApiUrl(rawUrl) {
    const url = new URL(rawUrl, window.location.href);
    const apiPathIndex = url.pathname.indexOf("/api/");
    if (backend && url.origin === window.location.origin && apiPathIndex >= 0) {
      return backend + url.pathname.slice(apiPathIndex) + url.search + url.hash;
    }
    return rawUrl;
  }

  window.fetch = function (input, init) {
    if (typeof input === "string" || input instanceof URL) {
      return originalFetch(rewriteApiUrl(String(input)), init);
    }
    if (input instanceof Request) {
      const target = rewriteApiUrl(input.url);
      if (target !== input.url) return originalFetch(new Request(target, input), init);
    }
    return originalFetch(input, init);
  };

  window.__VOICEAI_API_FETCH_PATCHED__ = true;
})();
