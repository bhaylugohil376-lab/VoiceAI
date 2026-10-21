/* =========================================================
   VoiceAI — Main JavaScript
   File: script.js
   ========================================================= */

"use strict";

  // GitHub Pages serves only static files, so route API calls to the Vercel backend.
  // Keep this patch idempotent because some pages load both shared scripts.
  if (!window.__VOICEAI_API_FETCH_PATCHED__) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const toBackend = (rawUrl) => {
        const url = new URL(rawUrl, window.location.href);
        const apiPathIndex = url.pathname.indexOf("/api/");
        if (url.origin === window.location.origin && apiPathIndex >= 0) {
          return "https://voice-ai-two-peach.vercel.app" + url.pathname.slice(apiPathIndex) + url.search + url.hash;
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


/* =========================================================
   DOM READY
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initLucide();
  initNavbar();
  initHeroGenerator();
  initAgent();
  initToolCards();
  initTextareaCounter();
});


/* =========================================================
   LUCIDE ICONS
========================================================= */

function initLucide() {
  if (window.lucide) {
    lucide.createIcons();
  }
}


/* =========================================================
   NAVBAR
========================================================= */

function initNavbar() {

  const currentPage =
    window.location.pathname
      .split("/")
      .pop()
      .toLowerCase() || "index.html";

  document
    .querySelectorAll(".nav-links a")
    .forEach((link) => {

      const href =
        link.getAttribute("href");

      if (!href) return;

      const page =
        href.split("/")
          .pop()
          .toLowerCase();

      link.classList.toggle(
        "active",
        page === currentPage
      );
    });
}


/* =========================================================
   HERO TEXT TO SPEECH
========================================================= */

function initHeroGenerator() {

  const button =
    document.getElementById("heroGenerateBtn");

  const textarea =
    document.getElementById("heroText");

  const voice =
    document.getElementById("heroVoice");

  if (!button || !textarea) {
    return;
  }

  button.addEventListener("click", () => {

    const text =
      textarea.value.trim();

    if (!text) {

      textarea.focus();

      showToast(
        "Please enter your script first."
      );

      return;
    }

    /*
     * The homepage voice choices are display presets, not provider voice IDs.
     * Pass only the script to the TTS page, where the real authenticated
     * ElevenLabs voice list is loaded and the user selects a valid voice.
     */

    window.VoiceAI?.save("tts_text", text);
    window.VoiceAI?.remove("tts_voice");
    window.VoiceAI?.remove("selected_voice_name");

    window.location.href =
      "tts.html";
  });
}


/* =========================================================
   AI AGENT
========================================================= */

function initAgent() {

  const button =
    document.getElementById("agentSendBtn");

  const input =
    document.getElementById("agentInput");

  if (!button || !input) {
    return;
  }

  function openAgent() {

    const message =
      input.value.trim();

    if (!message) {

      input.focus();

      return;
    }

    window.VoiceAI?.save("agent_draft", message);

    window.location.href =
      "agents.html";
  }

  button.addEventListener(
    "click",
    openAgent
  );

  input.addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Enter") {

        event.preventDefault();

        openAgent();
      }
    }
  );
}


/* =========================================================
   TOOL CARDS
========================================================= */

function initToolCards() {

  document
    .querySelectorAll(".tool-card")
    .forEach((card) => {

      card.addEventListener(
        "click",
        () => {

          const href =
            card.getAttribute("href");

          if (!href) {
            return;
          }

          card.classList.add(
            "tool-opening"
          );

        }
      );
    });
}


/* =========================================================
   TEXTAREA COUNTER
========================================================= */

function initTextareaCounter() {

  const textarea =
    document.getElementById("heroText");

  if (!textarea) {
    return;
  }

  const maxLength = 5000;

  textarea.setAttribute(
    "maxlength",
    maxLength
  );

  const generatorBody =
    textarea.closest(
      ".generator-body"
    );

  if (!generatorBody) {
    return;
  }

  const counter =
    document.createElement("div");

  counter.className =
    "text-counter";

  counter.style.cssText = `
    text-align:right;
    margin-top:6px;
    color:#526984;
    font-size:10px;
  `;

  textarea.insertAdjacentElement(
    "afterend",
    counter
  );

  function updateCounter() {

    counter.textContent =
      `${textarea.value.length}/${maxLength}`;
  }

  textarea.addEventListener(
    "input",
    updateCounter
  );

  updateCounter();
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {

  let toast =
    document.getElementById(
      "voiceai-toast"
    );

  if (!toast) {

    toast =
      document.createElement("div");

    toast.id =
      "voiceai-toast";

    toast.style.cssText = `
      position:fixed;
      left:50%;
      bottom:30px;
      transform:translateX(-50%) translateY(20px);
      z-index:9999;

      max-width:90%;
      padding:13px 18px;

      color:#eaf4ff;
      background:#0b172d;

      border:1px solid rgba(96,165,250,.30);
      border-radius:12px;

      box-shadow:0 15px 40px rgba(0,0,0,.45);

      font-size:13px;
      font-weight:600;

      opacity:0;
      pointer-events:none;

      transition:
        opacity .25s ease,
        transform .25s ease;
    `;

    document.body.appendChild(toast);
  }

  toast.textContent =
    message;

  toast.style.opacity =
    "1";

  toast.style.transform =
    "translateX(-50%) translateY(0)";

  clearTimeout(
    window.voiceaiToastTimer
  );

  window.voiceaiToastTimer =
    setTimeout(() => {

      toast.style.opacity =
        "0";

      toast.style.transform =
        "translateX(-50%) translateY(20px)";

    }, 2800);
}


/* =========================================================
   SESSION HELPERS
========================================================= */

window.VoiceAI = {

  save(key, value) {
    try {
      sessionStorage.setItem(`voiceai_${key}`, String(value ?? ""));
      return true;
    } catch (error) {
      console.warn("VoiceAI could not save session data:", error);
      showToast("Your browser blocked temporary storage. Please continue on the tool page.");
      return false;
    }
  },

  get(key) {
    try {
      return sessionStorage.getItem(`voiceai_${key}`);
    } catch (error) {
      console.warn("VoiceAI could not read session data:", error);
      return null;
    }
  },

  remove(key) {
    try {
      sessionStorage.removeItem(`voiceai_${key}`);
    } catch (error) {
      console.warn("VoiceAI could not clear session data:", error);
    }
  },

  toast(message) {

    showToast(message);
  }

};


/* =========================================================
   FINAL ICON REFRESH
========================================================= */

setTimeout(() => {

  if (window.lucide) {
    lucide.createIcons();
  }

}, 100);
