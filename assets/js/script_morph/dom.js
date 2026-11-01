import { scriptById } from "./util.js";

export function buildWidget(accessibleName) {
  const root = document.createElement("span");
  root.className = "script-morph";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", accessibleName);
  root.innerHTML = `
    <button type="button" class="script-morph__btn script-morph__btn--prev" aria-label="Previous script" title="Previous script">‹</button>
    <div class="script-morph__stage" tabindex="0" title="Script outline">
      <svg class="script-morph__svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
      <span class="script-morph__live sr-only" aria-live="polite"></span>
    </div>
    <button type="button" class="script-morph__btn script-morph__btn--next" aria-label="Next script" title="Next script">›</button>
    <span class="script-morph__script-name" aria-live="polite"></span>
    <button type="button" class="script-morph__btn script-morph__btn--fullscreen" aria-label="Expand script morph" title="Expand fullscreen">⛶</button>
    <button type="button" class="script-morph__btn script-morph__btn--exit" aria-label="Close script morph" title="Close">×</button>
    <span class="script-morph__phase" aria-live="polite" hidden></span>
  `;
  return {
    root,
    stage: root.querySelector(".script-morph__stage"),
    svg: root.querySelector(".script-morph__svg"),
    live: root.querySelector(".script-morph__live"),
    scriptNameEl: root.querySelector(".script-morph__script-name"),
    phaseEl: root.querySelector(".script-morph__phase"),
    btnPrev: root.querySelector(".script-morph__btn--prev"),
    btnNext: root.querySelector(".script-morph__btn--next"),
    btnFs: root.querySelector(".script-morph__btn--fullscreen"),
    btnExit: root.querySelector(".script-morph__btn--exit"),
  };
}

export function buildOverlay(carousel, data) {
  const overlay = document.createElement("div");
  overlay.className = "script-morph-overlay";
  const items = carousel
    .map((id) => {
      const s = scriptById(data, id);
      return `<li><button type="button" class="script-morph-chooser__btn" data-script="${id}">${s ? s.label : id}</button></li>`;
    })
    .join("");
  overlay.innerHTML = `
    <button type="button" class="script-morph-overlay__close" aria-label="Close fullscreen" title="Close fullscreen">×</button>
    <div class="script-morph-overlay__main">
      <div class="script-morph-overlay__stage"></div>
      <div class="script-morph__transport">
        <button type="button" class="script-morph__play" aria-label="Pause" title="Pause">❚❚</button>
        <div class="script-morph__seek-col">
          <span class="script-morph__phase" aria-live="polite" hidden></span>
          <div class="script-morph__seek-wrap">
            <input type="range" class="script-morph__seek" min="0" max="1000" value="0" step="1" aria-label="Seek morph timeline" title="Seek timeline" />
            <div class="script-morph__markers" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    </div>
    <aside class="script-morph-chooser" aria-label="Choose script">
      <p class="script-morph-chooser__title">scripts</p>
      <ul class="script-morph-chooser__list">${items}</ul>
    </aside>
  `;
  return {
    overlay,
    stageMount: overlay.querySelector(".script-morph-overlay__stage"),
    transportEl: overlay.querySelector(".script-morph__transport"),
    playBtn: overlay.querySelector(".script-morph__play"),
    seekEl: overlay.querySelector(".script-morph__seek"),
    markersEl: overlay.querySelector(".script-morph__markers"),
    phaseEl: overlay.querySelector(".script-morph__phase"),
    chooser: overlay.querySelector(".script-morph-chooser"),
    closeBtn: overlay.querySelector(".script-morph-overlay__close"),
  };
}

export function installMarkers(markersEl, plan) {
  if (!markersEl || !plan) return;
  const section = plan.segments.map((s) => {
    const pct = (s.start / plan.total) * 100;
    return `<button type="button" class="script-morph__marker" data-ms="${s.start}" data-label="${s.label}" style="left:${pct}%" title="${s.label}" aria-label="${s.label}"></button>`;
  });
  // Finer matra ticks inside morph/case segments (skip duplicates on section starts).
  const sectionStarts = new Set(plan.segments.map((s) => Math.round(s.start)));
  const fine = (plan.fineTicks || [])
    .filter((tick) => !sectionStarts.has(Math.round(tick.ms)))
    .map((tick) => {
      const pct = (tick.ms / plan.total) * 100;
      return `<button type="button" class="script-morph__marker script-morph__marker--fine" data-ms="${tick.ms}" data-label="${tick.label}" style="left:${pct}%" title="${tick.label}" aria-label="${tick.label}"></button>`;
    });
  markersEl.innerHTML = section.concat(fine).join("");
}

export function highlightMarker(transportEl, label) {
  if (!transportEl) return;
  transportEl.querySelectorAll(".script-morph__marker").forEach((el) => {
    el.classList.toggle("is-active", el.getAttribute("data-label") === label);
  });
}
