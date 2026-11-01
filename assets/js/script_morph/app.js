import {
  STORAGE_KEY,
  COMPACT_SCRIPTS,
  REDUCED,
  scriptById,
} from "./util.js";
import { planTimeline, stateAt } from "./timeline.js";
import { paint, paintScript } from "./paint.js";
import {
  buildWidget,
  buildOverlay,
  installMarkers,
  highlightMarker,
} from "./dom.js";

export class ScriptMorph {
  constructor(host, data) {
    this.host = host;
    this.label = host.querySelector(".script-morph-label");
    this.data = data;
    this.carousel = data.carousel.filter((id) => scriptById(data, id));
    this.compactCarousel = COMPACT_SCRIPTS.filter((id) =>
      this.carousel.includes(id)
    );
    this.index = this._loadIndex();
    this.active = false;
    this.fullscreen = false;
    this.animating = false;
    this._paused = false;
    this._playing = true;
    this._playheadMs = 0;
    this._timeline = null;
    this._fromId = null;
    this._toId = null;
    this._rafId = 0;
    this._lastTs = 0;
    this._seeking = false;
    this._gen = 0;

    Object.assign(this, buildWidget(data.accessible_name));
    host.appendChild(this.root);
    this._bind();
  }

  _loadIndex() {
    try {
      const v = parseInt(sessionStorage.getItem(STORAGE_KEY + ":" + this.data.id), 10);
      if (!isNaN(v) && v >= 0 && v < this.carousel.length) return v;
    } catch (_) {}
    return Math.max(0, this.carousel.indexOf("latin"));
  }

  _saveIndex() {
    try {
      sessionStorage.setItem(STORAGE_KEY + ":" + this.data.id, String(this.index));
    } catch (_) {}
  }

  _navList() {
    return this.fullscreen ? this.carousel : this.compactCarousel;
  }

  _bind() {
    this.btnPrev.addEventListener("click", (e) => {
      e.stopPropagation();
      this.step(-1);
    });
    this.btnNext.addEventListener("click", (e) => {
      e.stopPropagation();
      this.step(1);
    });
    this.btnFs.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openFullscreen();
    });
    this.btnExit.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deactivate();
    });
    this.stage.addEventListener("click", () => this.step(1));
    this.stage.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.step(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.deactivate();
      }
    });
    this._onDocKey = (e) => {
      if (e.key !== "Escape" || !this.active) return;
      if (this.fullscreen) this.closeFullscreen();
      else this.deactivate();
    };
    document.addEventListener("keydown", this._onDocKey);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.host.classList.add("is-active");
    const hint = this.host.querySelector(".script-morph-hint");
    if (hint) hint.classList.add("is-hidden");
    this.index = Math.max(0, this.carousel.indexOf("latin"));
    this._saveIndex();
    this._snap(this.carousel[this.index], true);
    this.stage.focus();
    this._syncChooser();
  }

  deactivate() {
    if (!this.active) return;
    if (this.fullscreen) this.closeFullscreen();
    this._stop();
    this.active = false;
    this.host.classList.remove("is-active");
    this.label.focus();
  }

  _announce(script) {
    this.live.textContent = script.label;
    if (this.scriptNameEl) this.scriptNameEl.textContent = script.label;
  }

  _setPhase(term) {
    if (!this.phaseEl) return;
    if (!term || !this.fullscreen) {
      this.phaseEl.hidden = true;
      this.phaseEl.textContent = "";
      return;
    }
    this.phaseEl.hidden = false;
    this.phaseEl.textContent = term;
    highlightMarker(this.transportEl, term);
  }

  _snap(scriptId, announce = false) {
    const script = scriptById(this.data, scriptId);
    if (!script) return;
    const joined = script.compose?.mode === "cursive" && script.joined;
    paintScript(this.svg, script, { joined: !!joined });
    this.root.dataset.script = scriptId;
    this.root.dataset.dir = script.dir;
    if (announce) this._announce(script);
    else this._syncScriptName(script);
  }

  _syncScriptName(script) {
    const s = script || scriptById(this.data, this.carousel[this.index]);
    if (this.scriptNameEl) this.scriptNameEl.textContent = s ? s.label : "";
  }

  step(delta) {
    if (!this.active) return;
    const list = this._navList();
    if (!list.length) return;
    const currentId = this.carousel[this.index];
    let pos = list.indexOf(currentId);
    if (pos < 0) pos = delta > 0 ? -1 : 0;
    this.goToScriptId(list[(pos + delta + list.length) % list.length]);
  }

  goToScriptId(scriptId) {
    const nextIndex = this.carousel.indexOf(scriptId);
    if (nextIndex < 0) return;
    this.goTo(nextIndex);
  }

  goTo(nextIndex) {
    if (!this.active) return;
    if (nextIndex === this.index && !this.animating) return;

    if (this.animating) {
      const committedId = this.carousel[this.index];
      this._stop();
      this._snap(committedId, false);
      if (nextIndex === this.index) {
        this._announce(scriptById(this.data, committedId));
        return;
      }
    }

    const fromId = this.carousel[this.index];
    const toId = this.carousel[nextIndex];
    this.index = nextIndex;
    this._saveIndex();
    this._syncChooser();
    this._syncScriptName(scriptById(this.data, toId));
    this._startTransition(fromId, toId, 0);
  }

  _syncChooser() {
    if (!this.chooser) return;
    this.chooser.querySelectorAll(".script-morph-chooser__btn").forEach((btn) => {
      const on = btn.getAttribute("data-script") === this.carousel[this.index];
      btn.setAttribute("aria-current", on ? "true" : "false");
    });
  }

  _stop() {
    this._gen += 1;
    this.animating = false;
    this._paused = false;
    this._playing = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._setPhase("");
    this._syncPlayButton();
  }

  _startTransition(fromId, toId, seekMs = 0) {
    const from = scriptById(this.data, fromId);
    const to = scriptById(this.data, toId);
    if (!from || !to) {
      this._snap(toId, true);
      return;
    }
    if (REDUCED) {
      this._snap(toId, true);
      return;
    }

    this._fromId = fromId;
    this._toId = toId;
    this._timeline = planTimeline(from, to, this.fullscreen);
    this._installTimeline(this._timeline);
    this._playheadMs = Math.max(0, Math.min(this._timeline.total, seekMs));
    this._gen += 1;
    const gen = this._gen;
    this.animating = true;
    this._paused = false;
    this._playing = true;
    this._syncPlayButton();
    this._lastTs = 0;
    this._paintAt(this._playheadMs);

    const tick = (ts) => {
      if (gen !== this._gen || !this.active) return;
      if (!this._lastTs) this._lastTs = ts;
      if (!this._paused && this._playing) {
        const dt = ts - this._lastTs;
        this._playheadMs = Math.min(
          this._timeline.total,
          this._playheadMs + dt
        );
        this._paintAt(this._playheadMs);
        if (this._playheadMs >= this._timeline.total) {
          this.animating = false;
          this._playing = false;
          this._setPhase("");
          this.root.dataset.script = toId;
          this.root.dataset.dir = to.dir;
          this._announce(to);
          this._syncPlayButton();
          this._syncTransport();
          return;
        }
      }
      this._lastTs = ts;
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _paintAt(ms) {
    if (!this._timeline) return;
    const state = stateAt(this._timeline, ms);
    paint(this.svg, state);
    this._setPhase(state.label);
    this._syncTransport();
  }

  _installTimeline(plan) {
    this._timeline = plan;
    if (!this.seekEl) return;
    this.seekEl.max = String(plan.total);
    this.seekEl.value = String(this._playheadMs || 0);
    installMarkers(this.markersEl, plan);
    this._syncTransport();
  }

  _syncTransport() {
    if (!this.seekEl || !this._timeline || this._seeking) return;
    this.seekEl.value = String(Math.min(this._playheadMs, this._timeline.total));
  }

  _syncPlayButton() {
    if (!this.playBtn) return;
    const paused = this._paused || !this._playing;
    this.playBtn.textContent = paused ? "▶" : "❚❚";
    this.playBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
  }

  _togglePlayPause() {
    if (!this.fullscreen) return;
    if (!this.animating) {
      if (this._fromId && this._toId) {
        this._startTransition(this._fromId, this._toId, 0);
      }
      return;
    }
    this._paused = !this._paused;
    this._playing = !this._paused;
    this._lastTs = 0;
    this._syncPlayButton();
  }

  _onSeekCommit(ms) {
    if (!this._timeline || !this._fromId || !this._toId) return;
    this._seeking = false;
    this._startTransition(this._fromId, this._toId, ms);
  }

  openFullscreen() {
    if (this.fullscreen || !this.active) return;
    this.fullscreen = true;

    const ui = buildOverlay(this.carousel, this.data);
    Object.assign(this, ui);
    document.body.appendChild(this.overlay);
    document.body.classList.add("script-morph-open");

    this._fsHost = document.createElement("div");
    this._fsHost.className = "script-morph-host is-active";
    this.stageMount.appendChild(this._fsHost);

    this._placeholder = document.createComment("script-morph-fs");
    this.root.parentNode.insertBefore(this._placeholder, this.root);
    this._fsHost.appendChild(this.root);
    this.root.classList.add("script-morph--fullscreen");
    this.btnFs.hidden = true;

    if (!this._timeline) {
      const cur = scriptById(this.data, this.carousel[this.index]);
      const prevId =
        this._fromId ||
        this.carousel[(this.index - 1 + this.carousel.length) % this.carousel.length];
      const prev = scriptById(this.data, prevId) || cur;
      if (cur) this._installTimeline(planTimeline(prev, cur, true));
    } else {
      // Rebuild durations for fullscreen timing.
      if (this._fromId && this._toId) {
        const from = scriptById(this.data, this._fromId);
        const to = scriptById(this.data, this._toId);
        const ratio = this._timeline.total
          ? this._playheadMs / this._timeline.total
          : 0;
        this._timeline = planTimeline(from, to, true);
        this._playheadMs = ratio * this._timeline.total;
        this._installTimeline(this._timeline);
        if (this.animating) this._paintAt(this._playheadMs);
      } else {
        this._installTimeline(this._timeline);
      }
    }

    this.playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._togglePlayPause();
    });
    this.seekEl.addEventListener("pointerdown", () => {
      this._seeking = true;
      this._paused = true;
      this._playing = false;
      this._syncPlayButton();
    });
    this.seekEl.addEventListener("input", () => {
      this._seeking = true;
      this._playheadMs = parseFloat(this.seekEl.value) || 0;
      if (this._timeline) this._paintAt(this._playheadMs);
    });
    const commit = () => {
      if (!this._seeking) return;
      this._onSeekCommit(parseFloat(this.seekEl.value) || 0);
    };
    this.seekEl.addEventListener("change", commit);
    this.seekEl.addEventListener("pointerup", commit);
    this.markersEl.addEventListener("click", (e) => {
      const marker = e.target.closest(".script-morph__marker");
      if (!marker) return;
      this._onSeekCommit(parseFloat(marker.getAttribute("data-ms")) || 0);
    });

    this.chooser.addEventListener("click", (e) => {
      const btn = e.target.closest(".script-morph-chooser__btn");
      if (!btn) return;
      this.goToScriptId(btn.getAttribute("data-script"));
    });
    this._syncChooser();
    this.closeBtn.addEventListener("click", () => this.closeFullscreen());
    this.closeBtn.focus();
  }

  closeFullscreen() {
    if (!this.fullscreen) return;
    this.fullscreen = false;
    this._paused = false;
    this._playing = true;
    this.btnFs.hidden = false;
    this.root.classList.remove("script-morph--fullscreen");
    this.chooser = null;
    this.transportEl = null;
    this.playBtn = null;
    this.seekEl = null;
    this.markersEl = null;
    this._setPhase("");
    if (this._placeholder?.parentNode) {
      this._placeholder.parentNode.insertBefore(this.root, this._placeholder);
      this._placeholder.remove();
    }
    if (this.overlay) this.overlay.remove();
    document.body.classList.remove("script-morph-open");
    this.overlay = null;
    if (this.active) this.stage.focus();
  }
}
