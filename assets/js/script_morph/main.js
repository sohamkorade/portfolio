import { ScriptMorph } from "./app.js";

async function bootHost(host) {
  const id = host.getAttribute("data-phrase");
  const url = host.getAttribute("data-src") || `${window.scriptMorphBase || ""}/assets/data/script_morph/${id}.json`;

  let morph = null;
  let loading = null;

  const ensure = async () => {
    if (morph) return morph;
    if (loading) return loading;
    loading = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      morph = new ScriptMorph(host, await res.json());
      return morph;
    })();
    try {
      return await loading;
    } catch (err) {
      loading = null;
      console.warn("script-morph: failed to load", id, err);
      throw err;
    }
  };

  const label = host.querySelector(".script-morph-label");
  if (!label) return;

  label.setAttribute("tabindex", "0");
  label.setAttribute("role", "button");
  label.setAttribute("aria-label", "Soham Korade, show in other scripts");

  let downX = 0;
  let downY = 0;
  let moved = false;
  const trackPointer = (el) => {
    el.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
    });
  };
  trackPointer(label);

  const hint = host.querySelector(".script-morph-hint");
  if (hint) {
    hint.classList.remove("is-hidden");
    hint.setAttribute("role", "button");
    hint.setAttribute("aria-label", "Show name in other scripts");
    trackPointer(hint);
  }

  const activate = async (source) => {
    try {
      (await ensure()).activate(source);
    } catch (_) {}
  };

  label.addEventListener("click", (e) => {
    if (moved) return;
    const sel = window.getSelection?.();
    if (sel?.toString() && label.contains(sel.anchorNode)) return;
    e.preventDefault();
    activate("name");
  });
  label.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate("keyboard");
    }
  });
  if (hint) {
    hint.addEventListener("click", (e) => {
      if (moved) return;
      e.preventDefault();
      activate("hint");
    });
  }
}

function boot() {
  document.querySelectorAll(".script-morph-host[data-phrase]").forEach(bootHost);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
