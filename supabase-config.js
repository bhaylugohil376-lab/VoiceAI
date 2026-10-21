(function () {
  "use strict";

  const SUPABASE_URL = "https://axeqcbavupmpijhaaite.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ktNCPoHwVtaMYfKTHTEODA_qEDo-8pp";

  // GitHub Pages serves only static files, so route API calls to the Vercel backend.
  // Keep this patch idempotent because some pages load both shared scripts.
  if (!window.__VOICEAI_API_FETCH_PATCHED__) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const toBackend = (rawUrl) => {
        const url = new URL(rawUrl, window.location.href);
        const apiPathIndex = url.pathname.indexOf("/api/");
        if (url.origin === window.location.origin && apiPathIndex >= 0) {
          return "https://voice-ai-bhaylugohil376-1885s-projects.vercel.app" + url.pathname.slice(apiPathIndex) + url.search + url.hash;
        }
        return rawUrl;
      };
      if (typeof input === "string" || input instanceof URL) {
        return originalFetch(toBackend(String(input)), init);
      }
      if (input instanceof Request) {
        const target = toBackend(input.url);
        if (target !== input.url) return originalFetch(new Request(target, input), init);
      }
      return originalFetch(input, init);
    };
    window.__VOICEAI_API_FETCH_PATCHED__ = true;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase SDK not loaded. Load @supabase/supabase-js before supabase-config.js");
    return;
  }

  // Browser storage can be unavailable in private/restricted contexts.
  // Keep auth usable without allowing storage exceptions to crash page startup.
  const safeStorage = {
    getItem(key) {
      try { return window.localStorage.getItem(key); } catch (_) { return null; }
    },
    setItem(key, value) {
      try { window.localStorage.setItem(key, value); } catch (error) {
        console.warn("Supabase session persistence is unavailable in this browser.");
      }
    },
    removeItem(key) {
      try { window.localStorage.removeItem(key); } catch (_) {}
    }
  };

  try {
    window.supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: safeStorage
        }
      }
    );
    console.info("Supabase client initialized.");
  } catch (error) {
    console.error("Supabase client initialization failed:", error);
  }
})();
