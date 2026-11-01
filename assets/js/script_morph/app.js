import {
  COMPACT_SCRIPTS,
  REDUCED,
  scriptById,
} from "./util.js";
import { planTimeline, stateAt, slotAnchorMs } from "./timeline.js";
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
    this.index = Math.max(0, this.carousel.indexOf("latin"));
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
    this.stage.addEventListener("pointerdown", (e) => this._onStagePointerDown(e));
    this.stage.addEventListener("pointerup", (e) => this._onStagePointerUp(e));
    this.stage.addEventListener("pointermove", (e) => this._onStagePointerMove(e));
    this.stage.addEventListener("pointerleave", () => this._onStagePointerLeave());
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

    // Always reopen on the first nav script, with first→second armed at t=0
    // (paused) so glyph seek / seekbar / play work immediately.
    const list = this._navList();
    const fromId = list[0] || this.carousel[0];
    const toId = list.length > 1 ? list[1] : fromId;
    this.index = Math.max(0, this.carousel.indexOf(fromId));
    this._syncChooser();
    this._announce(scriptById(this.data, fromId));

    if (!fromId || toId === fromId || REDUCED) {
      this._snap(fromId, true);
    } else {
      this._startTransition(fromId, toId, 0);
      this._paused = true;
      this._playing = false;
      this._lastTs = 0;
      this._syncPlayButton();
    }

    this.stage.focus();
    this._nudgeChevrons();
  }

  /** Flash prev+next so both navigation affordances are discoverable. */
  _nudgeChevrons() {
    const btns = [this.btnPrev, this.btnNext].filter(Boolean);
    if (!btns.length) return;
    btns.forEach((btn) => btn.classList.add("is-nudge"));
    clearTimeout(this._nudgeTimer);
    // 2 iterations × 0.55s — matches script-morph-chevron-flash.
    this._nudgeTimer = setTimeout(() => {
      btns.forEach((btn) => btn.classList.remove("is-nudge"));
    }, 1100);
  }

  deactivate() {
    if (!this.active) return;
    if (this.fullscreen) this.closeFullscreen();
    this._stop();
    this._fromId = null;
    this._toId = null;
    this._timeline = null;
    this._playheadMs = 0;
    this._hoverSlot = null;
    this._pressSlot = null;
    // Next open starts from the first script again.
    const firstId = this._navList()[0] || this.carousel[0];
    this.index = Math.max(0, this.carousel.indexOf(firstId));
    this.active = false;
    this.host.classList.remove("is-active");
    const hint = this.host.querySelector(".script-morph-hint");
    if (hint) hint.classList.remove("is-hidden");
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
    this._syncChooser();
    this._syncScriptName(scriptById(this.data, toId));
    this._startTransition(fromId, toId, 0);
  }

  _syncChooser() {
    if (!this.chooser) return;
    let selected = null;
    this.chooser.querySelectorAll(".script-morph-chooser__btn").forEach((btn) => {
      const on = btn.getAttribute("data-script") === this.carousel[this.index];
      btn.setAttribute("aria-current", on ? "true" : "false");
      if (on) selected = btn;
    });
    if (selected) {
      selected.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
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
          this.index = Math.max(0, this.carousel.indexOf(toId));
          this.root.dataset.script = toId;
          this.root.dataset.dir = to.dir;
          this._announce(to);
          this._syncChooser();
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
    state.hoverSlot = this._hoverSlot;
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
    this.playBtn.setAttribute("title", paused ? "Play" : "Pause");
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

  /** Resolve slot under the pointer from the live SVG (survives per-frame rebuilds). */
  _slotAtPoint(clientX, clientY) {
    if (!this.svg) return null;
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!this.svg.contains(node)) continue;
      const host = node.hasAttribute?.("data-slot")
        ? node
        : node.closest?.("[data-slot]");
      if (!host || !this.svg.contains(host)) continue;
      const slot = parseInt(host.getAttribute("data-slot"), 10);
      if (!Number.isNaN(slot)) return slot;
    }
    return null;
  }

  _onStagePointerDown(e) {
    // Capture slot now — while playing, SVG nodes are replaced every frame and
    // browsers often suppress `click` when the down-target is removed.
    this._pressSlot = this._slotAtPoint(e.clientX, e.clientY);
    this._pressX = e.clientX;
    this._pressY = e.clientY;
  }

  _onStagePointerMove(e) {
    const slot = this._slotAtPoint(e.clientX, e.clientY);
    if (slot === this._hoverSlot) return;
    this._hoverSlot = slot;
    // Repaint current frame so hover outline survives SVG rebuilds.
    if (this._timeline) this._paintAt(this._playheadMs || 0);
    else if (this.svg && this._hoverSlot != null) {
      // Static snap: re-paint current script with hover.
      const id = this.carousel[this.index];
      const script = scriptById(this.data, id);
      if (script) {
        const joined = script.compose?.mode === "cursive" && script.joined;
        paintScript(this.svg, script, {
          joined: !!joined,
          hoverSlot: this._hoverSlot,
        });
      }
    }
  }

  _onStagePointerLeave() {
    if (this._hoverSlot == null) return;
    this._hoverSlot = null;
    if (this._timeline) this._paintAt(this._playheadMs || 0);
    else {
      const id = this.carousel[this.index];
      const script = scriptById(this.data, id);
      if (script) {
        const joined = script.compose?.mode === "cursive" && script.joined;
        paintScript(this.svg, script, { joined: !!joined });
      }
    }
  }

  /** Pointer-up a glyph → seek to that slot's first morph step (option A). */
  _onStagePointerUp(e) {
    if (!this._timeline || !this._fromId || !this._toId) return;
    const slot = this._pressSlot;
    const x0 = this._pressX;
    const y0 = this._pressY;
    this._pressSlot = null;
    if (slot == null) return;
    if (
      x0 != null &&
      y0 != null &&
      Math.hypot(e.clientX - x0, e.clientY - y0) > 8
    ) {
      return;
    }
    const ms = slotAnchorMs(this._timeline, slot, this._playheadMs || 0);
    if (ms == null) return;
    e.preventDefault();
    this._onSeekCommit(ms);
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
    this.btnExit.hidden = true;

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
    // Blank fullscreen chrome dismisses; keep clicks on the morph / transport / chooser.
    this.overlay.addEventListener("click", (e) => {
      if (
        e.target.closest(
          ".script-morph, .script-morph__transport, .script-morph-chooser, .script-morph-overlay__close"
        )
      ) {
        return;
      }
      this.closeFullscreen();
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
    this.btnExit.hidden = false;
    this.root.classList.remove("script-morph--fullscreen");
    this.chooser = null;
    this.transportEl = null;
    this.playBtn = null;
    this.seekEl = null;
    this.markersEl = null;
    this.phaseEl = this.root.querySelector(".script-morph__phase");
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
