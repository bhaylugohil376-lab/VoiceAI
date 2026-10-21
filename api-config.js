(function () {
  "use strict";

  // GitHub Pages is static hosting; send /api requests to the Vercel backend.
  if (window.__VOICEAI_API_FETCH_PATCHED__) return;

  const backend = "https://voice-ai-bhaylugohil376-1885s-projects.vercel.app";
  const originalFetch = window.fetch.bind(window);

  function rewriteApiUrl(rawUrl) {
    const url = new URL(rawUrl, window.location.href);
    const apiPathIndex = url.pathname.indexOf("/api/");
    if (url.origin === window.location.origin && apiPathIndex >= 0) {
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
