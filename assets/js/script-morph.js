/**
 * Script-morph host: selectable English name by default.
 * Click/tap loads the SVG widget; × / Escape restores the label.
 */
(function () {
  const STORAGE_KEY = "script-morph-index";
  const SLOT_MORPH_MS = 480; // per-slot morph duration
  const SLOT_GAP_MS = 70; // pause between slots
  const CASE_MS = 320; // per-slot case fold
  const SETTLE_MS = 520; // fade boxes + ease into final layout
  const SLOT_PREP_MS = 520; // pack from-glyphs into to-sized slot cells
  const SPREAD_MS = 560; // morph slots → isolated tracking before cursive join
  const REVERSE_MS = 1100;
  const JOIN_STEP_MS = 1400; // per-letter combine into cursive (slow)
  const JOIN_GAP_MS = 220;
  const COMPACT_SPEED = 0.42; // non-fullscreen morphs run faster
  /** Compact widget cycles only these; fullscreen chooser keeps the full carousel. */
  const COMPACT_SCRIPTS = [
    "latin",
    "devanagari",
    "bengali",
    "kannada",
    "telugu",
    "malayalam",
    "tamil",
    "katakana",
    "urdu",
  ];
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pointsToPath(points) {
    if (!points || !points.length) return "";
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) d += `L${points[i][0]} ${points[i][1]}`;
    return d + "Z";
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function scriptById(data, id) {
    return data.scripts.find((s) => s.id === id);
  }

  /** Direct 1–1 transitions only (no intermediate hub scripts). */
  function resolvePath(_data, fromId, toId) {
    if (fromId === toId) return [toId];
    return [fromId, toId];
  }

  function slotOrigins(script) {
    const xs = [];
    let x = 0;
    script.slots.forEach((slot) => {
      xs.push(x);
      x += slot.advance || 0;
    });
    return { xs, width: x };
  }

  function slotBounds(script, opts = {}) {
    const isolGap = opts.isolGap || (script.family === "arabic" ? 120 : 0);
    let minY = Infinity;
    let maxY = -Infinity;
    let width = 0;
    script.slots.forEach((slot, i) => {
      width += slot.advance || 0;
      if (i < script.slots.length - 1) width += isolGap;
      if (slot.empty) return;
      const b = slot.bounds;
      minY = Math.min(minY, b[1]);
      maxY = Math.max(maxY, b[3]);
    });
    if (!isFinite(minY)) {
      minY = 0;
      maxY = 800;
    }
    return { minY, maxY, width, height: Math.max(maxY - minY, 1) };
  }

  /**
   * View-box metrics for display. Nastaliq's tall diagonals would otherwise shrink
   * the whole name — frame a mid body band and let extrema overshoot (overflow visible).
   */
  const ARABIC_DISPLAY_EM = 960;
  function displayMetrics(script, opts = {}) {
    const m = slotBounds(script, opts);
    if (script.family !== "arabic") return m;
    const inkCy = (m.minY + m.maxY) / 2;
    // Bias slightly upward: Nastaliq often hangs more below the body.
    const cy = inkCy + m.height * 0.06;
    const h = ARABIC_DISPLAY_EM;
    return {
      minY: cy - h / 2,
      maxY: cy + h / 2,
      height: h,
      width: m.width,
      tight: true,
    };
  }

  function setViewBox(svg, metrics) {
    // Less pad for optically-framed Arabic so the body stays large in the h1 em.
    const pad = metrics.height * (metrics.tight ? 0.04 : 0.1);
    svg.setAttribute(
      "viewBox",
      `0 ${metrics.minY - pad} ${Math.max(metrics.width, 1)} ${metrics.height + pad * 2}`
    );
  }

  /**
   * Scale + vertical shift so `to` matches `from`'s visual em size during morph.
   * Keeps the from script from appearing to resize when scripts have different extents.
   */
  function morphToFit(from, to) {
    const fromM = displayMetrics(from);
    const toM = displayMetrics(to);
    const scale = toM.height > 0 ? fromM.height / toM.height : 1;
    const fromCy = (fromM.minY + fromM.maxY) / 2;
    const toCy = ((toM.minY + toM.maxY) / 2) * scale;
    return { scale, dy: fromCy - toCy, fromM, toM };
  }

  /** True when a slot needs no morph (identical outline / both empty). */
  function slotsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.empty && b.empty) return true;
    const pa = a.path || "";
    const pb = b.path || "";
    if (pa || pb) return pa === pb;
    const ta = a.text != null ? a.text : "";
    const tb = b.text != null ? b.text : "";
    return ta === tb && (a.advance || 0) === (b.advance || 0);
  }

  class ScriptMorph {
    constructor(host, data) {
      this.host = host;
      this.label = host.querySelector(".script-morph-label");
      this.data = data;
      this.carousel = data.carousel.filter((id) => scriptById(data, id));
      this.compactCarousel = COMPACT_SCRIPTS.filter((id) =>
        this.carousel.includes(id)
      );
      this.index = this._loadIndex();
      this.animating = false;
      this.active = false;
      this.fullscreen = false;
      this._animToken = 0;
      this._animTimers = [];
      this._paused = false;
      this._playing = true;
      this._timeline = null;
      this._playheadMs = 0;
      this._phaseStartMs = 0;
      this._ffUntil = null;
      this._transitionFromId = null;
      this._transitionToId = null;
      this._seeking = false;
      this._build();
      this._bind();
    }

    /** Duration scaled for compact vs fullscreen. */
    _ms(base) {
      if (!base) return 0;
      return this.fullscreen ? base : Math.max(40, base * COMPACT_SPEED);
    }

    /** Start a new animation generation; invalidates any in-flight work. */
    _beginAnim() {
      this._clearAnimTimers();
      this._animToken += 1;
      this.animating = true;
      this._paused = false;
      this._playing = true;
      this._syncPlayButton();
      return this._animToken;
    }

    /** Abort in-flight morphs so a new user action can take over. */
    _cancelAnimation() {
      this._animToken += 1;
      this.animating = false;
      this._clearAnimTimers();
      this._setPhase("");
      this._ffUntil = null;
    }

    _clearAnimTimers() {
      this._animTimers.forEach((id) => clearTimeout(id));
      this._animTimers = [];
    }

    _still(token) {
      return this.active && token === this._animToken;
    }

    /**
     * Token-aware delay; pauses when transport is paused; resolves false if cancelled.
     * Advances the fullscreen playhead while waiting.
     */
    _wait(token, ms) {
      const dur = this._ms(ms);
      return new Promise((resolve) => {
        if (this._ffUntil != null) {
          const end = this._phaseStartMs + dur;
          if (this._ffUntil >= end) {
            this._playheadMs = end;
            this._phaseStartMs = end;
            this._syncTransport();
            resolve(this._still(token));
            return;
          }
        }
        let elapsed = 0;
        let last = performance.now();
        const tick = (now) => {
          if (!this._still(token)) {
            resolve(false);
            return;
          }
          if (this._paused) {
            last = now;
            this._raf(token, tick);
            return;
          }
          const dt = now - last;
          last = now;
          elapsed += dt;
          this._playheadMs = this._phaseStartMs + Math.min(elapsed, dur);
          this._syncTransport();
          if (elapsed >= dur) {
            this._phaseStartMs += dur;
            this._playheadMs = this._phaseStartMs;
            this._syncTransport();
            resolve(true);
            return;
          }
          this._raf(token, tick);
        };
        this._raf(token, tick);
      });
    }

    /**
     * Pause-aware progress animation 0→1. onProgress(eased, raw).
     * Honors fast-forward seek targets.
     */
    _animate(token, ms, onProgress) {
      const dur = Math.max(1, this._ms(ms));
      return new Promise((resolve) => {
        if (!this._still(token)) {
          resolve(false);
          return;
        }
        const phaseStart = this._phaseStartMs;
        const phaseEnd = phaseStart + dur;

        if (this._ffUntil != null && this._ffUntil >= phaseEnd) {
          onProgress(1, 1);
          this._phaseStartMs = phaseEnd;
          this._playheadMs = phaseEnd;
          this._syncTransport();
          resolve(true);
          return;
        }

        let elapsed = 0;
        if (this._ffUntil != null && this._ffUntil > phaseStart) {
          elapsed = Math.min(dur, this._ffUntil - phaseStart);
          this._ffUntil = null;
          const raw0 = elapsed / dur;
          onProgress(easeInOut(raw0), raw0);
        }

        let last = performance.now();
        const frame = (now) => {
          if (!this._still(token)) {
            resolve(false);
            return;
          }
          if (this._paused) {
            last = now;
            this._raf(token, frame);
            return;
          }
          elapsed += now - last;
          last = now;
          const raw = Math.min(1, elapsed / dur);
          onProgress(easeInOut(raw), raw);
          this._playheadMs = phaseStart + elapsed;
          this._syncTransport();
          if (raw < 1) {
            this._raf(token, frame);
            return;
          }
          this._phaseStartMs = phaseEnd;
          this._playheadMs = phaseEnd;
          this._syncTransport();
          resolve(true);
        };
        this._raf(token, frame);
      });
    }

    /** Token-aware rAF; skips callback if cancelled. */
    _raf(token, fn) {
      requestAnimationFrame((now) => {
        if (!this._still(token)) return;
        fn(now);
      });
    }

    _beginPhase(label, estimatedMs) {
      this._setPhase(label);
      if (this._timeline && estimatedMs != null) {
        // Keep playhead within the active segment when phases re-enter.
        const seg = this._timeline.segments.find(
          (s) => s.label === label && this._playheadMs + 1 >= s.start && this._playheadMs <= s.end + 1
        ) || this._timeline.segments.find((s) => s.label === label && this._playheadMs <= s.end);
        if (seg) this._phaseStartMs = Math.max(this._phaseStartMs, seg.start);
      }
      this._syncTransport();
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

    _build() {
      this.root = document.createElement("span");
      this.root.className = "script-morph";
      this.root.setAttribute("role", "group");
      this.root.setAttribute("aria-label", this.data.accessible_name);
      this.root.innerHTML = `
        <button type="button" class="script-morph__btn script-morph__btn--prev" aria-label="Previous script">‹</button>
        <div class="script-morph__stage" tabindex="0">
          <svg class="script-morph__svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
          <span class="script-morph__live sr-only" aria-live="polite"></span>
        </div>
        <button type="button" class="script-morph__btn script-morph__btn--next" aria-label="Next script">›</button>
        <span class="script-morph__script-name" aria-live="polite"></span>
        <button type="button" class="script-morph__btn script-morph__btn--fullscreen" aria-label="Expand script morph">⛶</button>
        <button type="button" class="script-morph__btn script-morph__btn--exit" aria-label="Close script morph">×</button>
        <span class="script-morph__phase" aria-live="polite" hidden></span>
      `;
      this.host.appendChild(this.root);

      this.stage = this.root.querySelector(".script-morph__stage");
      this.svg = this.root.querySelector(".script-morph__svg");
      this.live = this.root.querySelector(".script-morph__live");
      this.scriptNameEl = this.root.querySelector(".script-morph__script-name");
      this.phaseEl = this.root.querySelector(".script-morph__phase");
      this.btnPrev = this.root.querySelector(".script-morph__btn--prev");
      this.btnNext = this.root.querySelector(".script-morph__btn--next");
      this.btnFs = this.root.querySelector(".script-morph__btn--fullscreen");
      this.btnExit = this.root.querySelector(".script-morph__btn--exit");
    }

    /** Compact cycles a short list; fullscreen uses the full carousel. */
    _navList() {
      return this.fullscreen ? this.carousel : this.compactCarousel;
    }

    _syncScriptName(script) {
      const s = script || scriptById(this.data, this.carousel[this.index]);
      if (!this.scriptNameEl) return;
      this.scriptNameEl.textContent = s ? s.label : "";
    }

    _setPhase(term) {
      if (!this.phaseEl) return;
      // Phase labels are fullscreen-only (compact widget stays quiet).
      if (!term || !this.fullscreen) {
        this.phaseEl.hidden = true;
        this.phaseEl.textContent = "";
        return;
      }
      this.phaseEl.hidden = false;
      this.phaseEl.textContent = term;
      this._highlightTimelineSegment(term);
    }

    _countChangedSlots(a, b) {
      if (!a || !b || !a.slots || !b.slots) return 0;
      let n = 0;
      for (let i = 0; i < a.slots.length; i++) {
        if (!slotsEqual(a.slots[i], b.slots[i])) n += 1;
      }
      return n;
    }

    _morphDurationMs(from, to, opts = {}) {
      const changed = this._countChangedSlots(from, to);
      const slotMs = opts.duration || SLOT_MORPH_MS;
      const prep = opts.sameScript ? 0 : SLOT_PREP_MS;
      const gaps = Math.max(0, changed - 1) * SLOT_GAP_MS;
      return prep + changed * slotMs + gaps;
    }

    /** Build a seekable phase timeline for the from→to transition. */
    _planTimeline(from, to) {
      const segments = [];
      let t = 0;
      const add = (id, label, baseMs) => {
        const duration = this._ms(baseMs);
        segments.push({ id, label, start: t, end: t + duration, duration, baseMs });
        t += duration;
      };

      let morphFrom = from;
      if (from.id === "latin" && from.slots_lower) {
        add("case-out", "Case folding", this._morphDurationMs(from, { ...from, slots: from.slots_lower }, { duration: CASE_MS, sameScript: true }));
        morphFrom = { ...from, slots: from.slots_lower };
      }

      let morphTo = to;
      const enteringLatin = to.id === "latin" && to.slots_lower;
      if (enteringLatin) morphTo = { ...to, slots: to.slots_lower };

      const enteringCursive = to.compose && to.compose.mode === "cursive";
      const leavingCursive = from.compose && from.compose.mode === "cursive";

      if (enteringCursive) {
        add("reverse", "Reading-order reversal", REVERSE_MS);
        add("morph", "Grapheme correspondence", this._morphDurationMs(morphFrom, morphTo));
        add("spread", "Isolation spacing", SPREAD_MS);
        const joinSteps = (to.join_steps || []).length || to.slots.length;
        add(
          "join",
          to.compose.term || "Cursive joining",
          joinSteps * JOIN_STEP_MS + Math.max(0, joinSteps - 1) * JOIN_GAP_MS
        );
      } else if (leavingCursive) {
        add("segregate", "Cursive segregation", 80);
        add("morph", "Grapheme correspondence", this._morphDurationMs(morphFrom, morphTo));
        add("unreverse", "Reading-order reversal", REVERSE_MS);
      } else {
        add("morph", "Grapheme correspondence", this._morphDurationMs(morphFrom, morphTo));
      }

      if (to.compose && to.compose.mode === "attach") {
        const steps = (to.compose.steps || []).length || 1;
        add(
          "attach",
          (to.compose.steps && to.compose.steps[0] && to.compose.steps[0].term) ||
            to.compose.term ||
            "Mark attachment",
          steps * JOIN_STEP_MS
        );
      }

      if (enteringLatin) {
        add(
          "case-in",
          "Case folding",
          this._morphDurationMs(
            { ...to, slots: to.slots_lower },
            to,
            { duration: CASE_MS, sameScript: true }
          )
        );
      }

      add("settle", "Metric settling", SETTLE_MS);
      return { segments, total: Math.max(t, 1) };
    }

    _installTimeline(plan) {
      this._timeline = plan;
      this._playheadMs = 0;
      this._phaseStartMs = 0;
      if (!this.transportEl || !this.seekEl) return;
      this.seekEl.max = String(plan.total);
      this.seekEl.value = "0";
      const marks = this.transportEl.querySelector(".script-morph__markers");
      if (marks) {
        marks.innerHTML = plan.segments
          .map((s) => {
            const pct = (s.start / plan.total) * 100;
            return `<button type="button" class="script-morph__marker" data-ms="${s.start}" data-label="${s.label}" style="left:${pct}%" title="${s.label}" aria-label="${s.label}"></button>`;
          })
          .join("");
      }
      this._syncTransport();
    }

    _syncTransport() {
      if (!this.seekEl || !this._timeline) return;
      if (this._seeking) return;
      this.seekEl.value = String(Math.min(this._playheadMs, this._timeline.total));
    }

    _syncPlayButton() {
      if (!this.playBtn) return;
      const paused = this._paused || !this._playing;
      this.playBtn.textContent = paused ? "▶" : "❚❚";
      this.playBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
    }

    _highlightTimelineSegment(label) {
      if (!this.transportEl) return;
      this.transportEl.querySelectorAll(".script-morph__marker").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-label") === label);
      });
    }

    _togglePlayPause() {
      if (!this.fullscreen) return;
      if (!this.animating) {
        // Replay current transition if idle.
        if (this._transitionFromId && this._transitionToId) {
          this._playing = true;
          this._paused = false;
          this._syncPlayButton();
          this._restartTransition(0);
        }
        return;
      }
      this._paused = !this._paused;
      this._playing = !this._paused;
      this._syncPlayButton();
    }

    _restartTransition(seekMs) {
      const fromId = this._transitionFromId;
      const toId = this._transitionToId;
      if (!fromId || !toId) return;
      this._cancelAnimation();
      this._snapScript(fromId, false);
      this._ffUntil = Math.max(0, seekMs || 0);
      this._playheadMs = this._ffUntil;
      this._phaseStartMs = 0;
      this._paused = false;
      this._playing = true;
      this._syncPlayButton();
      this._transition(fromId, toId);
    }

    _onSeekInput(ms, commit) {
      if (!this._timeline) return;
      const clamped = Math.max(0, Math.min(this._timeline.total, ms));
      this._playheadMs = clamped;
      if (!commit) return;
      this._seeking = false;
      this._restartTransition(clamped);
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
      this._hideHint();
      // Start from Latin when opening from the English label
      this.index = Math.max(0, this.carousel.indexOf("latin"));
      this._saveIndex();
      this._renderScript(this.carousel[this.index], true, { joined: false });
      this.stage.focus();
      this._syncChooser();
    }

    deactivate() {
      if (!this.active) return;
      if (this.fullscreen) this.closeFullscreen();
      this._cancelAnimation();
      this.active = false;
      this.host.classList.remove("is-active");
      this.label.focus();
    }

    _hideHint() {
      const hint = this.host.querySelector(".script-morph-hint");
      if (hint) hint.classList.add("is-hidden");
    }

    /** Final settled render for a script (joined when cursive). */
    _snapScript(scriptId, announce = false) {
      const script = scriptById(this.data, scriptId);
      const joined = !!(
        script &&
        script.compose &&
        script.compose.mode === "cursive" &&
        script.joined
      );
      this._renderScript(scriptId, announce, { joined });
    }

    step(delta) {
      if (!this.active) return;
      const list = this._navList();
      if (!list.length) return;
      const currentId = this.carousel[this.index];
      let pos = list.indexOf(currentId);
      // If viewing a fullscreen-only script while compact, start from the first compact entry.
      if (pos < 0) pos = delta > 0 ? -1 : 0;
      const nextId = list[(pos + delta + list.length) % list.length];
      this.goToScriptId(nextId);
    }

    goTo(nextIndex) {
      if (!this.active) return;
      if (nextIndex === this.index && !this.animating) return;

      // User action wins: abort the in-flight morph and snap to its committed target.
      if (this.animating) {
        const committedId = this.carousel[this.index];
        this._cancelAnimation();
        this._snapScript(committedId, false);
        if (nextIndex === this.index) {
          const committed = scriptById(this.data, committedId);
          if (committed) this._announce(committed);
          return;
        }
      }

      const fromId = this.carousel[this.index];
      const toId = this.carousel[nextIndex];
      this.index = nextIndex;
      this._saveIndex();
      this._syncChooser();
      this._syncScriptName(scriptById(this.data, toId));
      this._transition(fromId, toId);
    }

    goToScriptId(scriptId) {
      const nextIndex = this.carousel.indexOf(scriptId);
      if (nextIndex < 0) return;
      this.goTo(nextIndex);
    }

    _syncChooser() {
      if (!this.chooser) return;
      this.chooser.querySelectorAll(".script-morph-chooser__btn").forEach((btn) => {
        const on = btn.getAttribute("data-script") === this.carousel[this.index];
        btn.setAttribute("aria-current", on ? "true" : "false");
      });
    }

    _announce(script) {
      this.live.textContent = script.label;
      this._syncScriptName(script);
    }

    _renderScript(scriptId, announce = true, opts = {}) {
      const script = scriptById(this.data, scriptId);
      if (!script) return;
      const useJoined = opts.joined === true && script.joined && script.joined.path;
      const reversed = !!opts.reversed;

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("script-morph__row");

      if (useJoined) {
        const jm = script.joined;
        const metrics = displayMetrics({
          ...script,
          slots: [
            {
              empty: false,
              advance: jm.advance || 0,
              bounds: jm.bounds || [0, 0, jm.advance || 1, 800],
            },
          ],
        });
        metrics.width = Math.max(jm.advance || metrics.width, 1);
        setViewBox(this.svg, metrics);
        const joined = document.createElementNS("http://www.w3.org/2000/svg", "path");
        joined.classList.add("script-morph__joined");
        joined.setAttribute("d", jm.path);
        g.appendChild(joined);
      } else {
        const order = reversed
          ? script.slots.map((_, i) => script.slots.length - 1 - i)
          : script.slots.map((_, i) => i);
        const metrics = displayMetrics(script);
        setViewBox(this.svg, metrics);

        // Extra tracking for joining scripts so isolated letters read as separate
        // before the R→L join sweep.
        const isolGap = script.family === "arabic" ? 120 : 0;
        let x = 0;
        order.forEach((logicalIndex, visualIndex) => {
          const slot = script.slots[logicalIndex];
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("class", "script-morph__slot");
          path.dataset.slot = String(logicalIndex);
          path.dataset.visual = String(visualIndex);
          path.setAttribute("transform", `translate(${x}, 0)`);
          path.setAttribute("d", slot.path || pointsToPath(slot.points));
          g.appendChild(path);
          x += (slot.advance || 0) + isolGap;
        });
      }

      this.svg.replaceChildren(g);
      this.svg.style.transform = "scale(1, -1)";
      this.root.dataset.script = scriptId;
      this.root.dataset.dir = script.dir;
      if (announce) this._announce(script);
    }

    async _transition(fromId, toId) {
      const from = scriptById(this.data, fromId);
      const to = scriptById(this.data, toId);
      if (!from || !to) {
        this._renderScript(toId);
        return;
      }
      if (REDUCED) {
        this._snapScript(toId, true);
        return;
      }

      this._transitionFromId = fromId;
      this._transitionToId = toId;
      const plan = this._planTimeline(from, to);
      this._installTimeline(plan);

      const token = this._beginAnim();
      // Preserve seek target across beginAnim reset of pause flags.
      if (this._ffUntil != null) {
        this._playheadMs = this._ffUntil;
        this._syncTransport();
      }
      const enteringCursive =
        to.compose && to.compose.mode === "cursive";
      const leavingCursive =
        from.compose && from.compose.mode === "cursive";
      try {
        // Lowercase English before leaving it.
        let morphFrom = from;
        if (from.id === "latin" && from.slots_lower) {
          this._beginPhase("Case folding");
          await this._caseFold(from, /*toLower=*/ true, token);
          if (!this._still(token)) return;
          morphFrom = { ...from, slots: from.slots_lower };
        }

        // Arrive into lowercase English first, then restore case.
        let morphTo = to;
        const enteringLatin = to.id === "latin" && to.slots_lower;
        if (enteringLatin) {
          morphTo = { ...to, slots: to.slots_lower };
        }

        if (enteringCursive || leavingCursive) {
          await this._cursiveTransition(morphFrom, morphTo, token);
          if (!this._still(token)) return;
        } else {
          this._beginPhase("Grapheme correspondence");
          const hops = resolvePath(this.data, fromId, toId);
          for (let i = 1; i < hops.length; i++) {
            const a = i === 1 ? morphFrom : scriptById(this.data, hops[i - 1]);
            const b =
              i === hops.length - 1 ? morphTo : scriptById(this.data, hops[i]);
            await this._morphSlots(a, b, false, { settle: false, token });
            if (!this._still(token)) return;
          }
        }

        // Data-driven post-morph composition (anusvāra attach, etc.).
        if (to.compose && to.compose.mode === "attach") {
          await this._composeAttach(to, token);
          if (!this._still(token)) return;
        }

        if (enteringLatin) {
          this._beginPhase("Case folding");
          await this._caseFold(to, /*toLower=*/ false, token);
          if (!this._still(token)) return;
        }

        // One final metric settle: collapse slot scaffolding into continuous text.
        this._beginPhase("Metric settling");
        await this._settleMetrics(to, token);
        if (!this._still(token)) return;

        this._setPhase("");
        this._playheadMs = plan.total;
        this._syncTransport();
        this.root.dataset.script = toId;
        this.root.dataset.dir = to.dir;
        this._announce(to);
      } finally {
        if (this._animToken === token) {
          this.animating = false;
          this._ffUntil = null;
          this._setPhase("");
          this._syncPlayButton();
        }
      }
    }

    /** Animate Latin proper ↔ lowercase slot-by-slot. */
    _caseFold(script, toLower, token) {
      if (!script.slots_lower) return Promise.resolve();
      const from = {
        ...script,
        slots: toLower ? script.slots : script.slots_lower,
      };
      const to = {
        ...script,
        slots: toLower ? script.slots_lower : script.slots,
      };
      return this._morphSlots(from, to, false, {
        duration: CASE_MS,
        sameScript: true,
        settle: false,
        token,
        skipPrep: true,
      });
    }

    /**
     * Morph slots one-by-one using crisp dual-path crossfades (no point-cloud artifacts).
     * Unchanged slots (identical path / both empty) are skipped — no time, no highlight.
     * LTR: left → right. Urdu/reversed: right → left.
     * opts.duration overrides per-slot timing; opts.sameScript softens dual coloring.
     * opts.settle defaults to false — metric settle runs once at end of _transition.
     */
    _morphSlots(from, to, reversed, opts = {}) {
      return new Promise((resolve) => {
        const token = opts.token != null ? opts.token : this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        const n = from.slots.length;
        const fromGap = from.family === "arabic" ? 120 : 0;
        const slotMs = this._ms(opts.duration || SLOT_MORPH_MS);
        const gapMs = this._ms(SLOT_GAP_MS);
        const prepMs = this._ms(SLOT_PREP_MS);
        const doSettle = opts.settle === true;
        const logicalAt = (visual) => (reversed ? n - 1 - visual : visual);
        // Fit `to` into `from`'s em so the outgoing script doesn't resize mid-morph.
        const fit = opts.sameScript
          ? { scale: 1, dy: 0, fromM: slotBounds(from) }
          : morphToFit(from, to);
        const toScale = fit.scale;
        const toDy = fit.dy;

        // Fast-forward: skip whole morph when seek is past this segment.
        const estBase = this._morphDurationMs(from, to, opts);
        const est = this._ms(estBase);
        if (this._ffUntil != null && this._ffUntil >= this._phaseStartMs + est) {
          this._renderScript(to.id, false, {
            joined: false,
            reversed: !!reversed,
          });
          this._phaseStartMs += est;
          this._playheadMs = this._phaseStartMs;
          this._syncTransport();
          resolve();
          return;
        }

        // Build dual-path slot groups once (accurate outlines).
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.classList.add("script-morph__row");
        if (opts.sameScript) g.classList.add("script-morph__row--casefold");
        const groups = [];
        const progress = new Array(n).fill(0);
        const visualOrder = [];
        const boxPad = 28;
        for (let visual = 0; visual < n; visual++) {
          const logical = logicalAt(visual);
          const a = from.slots[logical];
          const b = to.slots[logical];
          const changed = !slotsEqual(a, b);
          const advA = a.advance || 0;
          const advB = (b.advance || 0) * toScale;
          // Reserve the wider advance so from/to never spill into neighboring slots.
          const endCellW = Math.max(advA, advB, 1);
          const startCellW = Math.max(advA, 1);

          const slotG = document.createElementNS("http://www.w3.org/2000/svg", "g");
          slotG.classList.add("script-morph__slot-pair");
          slotG.dataset.slot = String(logical);
          slotG.dataset.visual = String(visual);
          if (!changed) slotG.classList.add("is-unchanged");

          const ba = a.bounds || [0, 0, advA, 800];
          const bbRaw = b.bounds || [0, 0, b.advance || 0, 800];
          const bb = [
            bbRaw[0] * toScale,
            bbRaw[1] * toScale + toDy,
            bbRaw[2] * toScale,
            bbRaw[3] * toScale + toDy,
          ];
          const by = Math.min(ba[1], bb[1]) - boxPad;
          const bh = Math.max(ba[3], bb[3]) - Math.min(ba[1], bb[1]) + boxPad * 2;

          const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          box.classList.add("script-morph__slot-box");
          box.setAttribute("x", String(-boxPad));
          box.setAttribute("y", String(by));
          box.setAttribute("width", String(startCellW + boxPad * 2));
          box.setAttribute("height", String(Math.max(bh, 1)));
          box.setAttribute("rx", "20");
          box.style.opacity = "0";

          const pathFrom = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathFrom.classList.add("script-morph__slot", "script-morph__slot--from");
          pathFrom.setAttribute("d", a.path || pointsToPath(a.points));
          // Start packed like continuous text; prep animates into centered cells.
          pathFrom.setAttribute("transform", "translate(0, 0)");
          pathFrom.style.opacity = changed ? "1" : "0";

          const pathTo = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathTo.classList.add("script-morph__slot", "script-morph__slot--to");
          pathTo.setAttribute("d", b.path || pointsToPath(b.points));
          const toPadX = (endCellW - advB) / 2;
          const fromPadX = (endCellW - advA) / 2;
          pathTo.setAttribute(
            "transform",
            `translate(${toPadX}, ${toDy}) scale(${toScale})`
          );
          pathTo.style.opacity = changed ? "0" : "1";

          slotG.appendChild(box);
          slotG.appendChild(pathFrom);
          slotG.appendChild(pathTo);
          g.appendChild(slotG);
          groups.push({
            slotG,
            pathFrom,
            pathTo,
            box,
            a,
            b,
            visual,
            logical,
            changed,
            advA,
            advB,
            startCellW,
            endCellW,
            cellW: endCellW,
            fromPadX,
            toPadX,
          });
          if (changed) {
            visualOrder.push(visual);
          } else {
            progress[visual] = 1;
          }
        }
        // Animate changed slots in reading order (RTL when reversed).
        if (reversed) visualOrder.reverse();

        this.svg.replaceChildren(g);
        this.svg.style.transform = "scale(1, -1)";

        // Start: natural from packing. End: cells sized for max(from, scaled-to).
        let startX = 0;
        let endX = 0;
        groups.forEach((item, visual) => {
          item.startX = startX;
          item.endX = endX;
          item.fixedX = endX;
          item.slotG.setAttribute("transform", `translate(${startX}, 0)`);
          startX += item.startCellW + (visual < n - 1 ? fromGap : 0);
          endX += item.endCellW + (visual < n - 1 ? fromGap : 0);
        });
        const startMetrics = {
          minY: fit.fromM.minY,
          maxY: fit.fromM.maxY,
          height: fit.fromM.height,
          width: Math.max(fit.fromM.width, startX, 1),
          tight: !!fit.fromM.tight,
        };
        const endMetrics = {
          minY: fit.fromM.minY,
          maxY: fit.fromM.maxY,
          height: fit.fromM.height,
          width: Math.max(fit.fromM.width, endX, 1),
          tight: !!fit.fromM.tight,
        };
        setViewBox(this.svg, startMetrics);

        const needsSlotPrep = groups.some(
          (item) =>
            Math.abs(item.startCellW - item.endCellW) > 0.5 ||
            Math.abs(item.startX - item.endX) > 0.5 ||
            item.changed
        );

        let step = 0;
        let stepStarted = performance.now();
        let pauseAnchor = 0;
        const morphPhaseOrigin = this._phaseStartMs;

        const paint = () => {
          groups.forEach((item, visual) => {
            const t = progress[visual];
            item.slotG.setAttribute("transform", `translate(${item.fixedX}, 0)`);
            if (!item.changed) {
              item.pathFrom.style.opacity = "0";
              item.pathTo.style.opacity = "1";
              item.box.classList.remove("is-active");
              item.box.style.opacity = "0";
              return;
            }
            item.pathFrom.style.opacity = String(1 - t);
            item.pathTo.style.opacity = String(t);
            const active = visualOrder[step] === visual && t < 1;
            item.box.classList.toggle("is-active", active || (t > 0 && t < 1));
            item.box.style.opacity =
              t > 0 && t < 1 ? "1" : t === 0 && visualOrder[step] === visual ? "0.85" : "0.35";
          });
        };

        /** Snap glyphs to the `to` state; keep slot boxes for a later metric settle. */
        const finishMorph = () => {
          groups.forEach((item) => {
            item.pathFrom.remove();
            item.pathTo.classList.remove(
              "script-morph__slot--to",
              "script-morph__slot--from"
            );
            item.pathTo.classList.add("script-morph__slot");
            item.pathTo.style.opacity = "1";
            item.pathTo.classList.add("script-morph__slot--settling");
            item.pathTo.setAttribute(
              "transform",
              `translate(${item.toPadX}, ${toDy}) scale(${toScale})`
            );
            item.box.classList.remove("is-active");
            item.box.style.opacity = item.changed ? "0.35" : "0";
            // Natural (unscaled) advance for the final metric settle.
            item.slotG.dataset.advance = String(item.b.advance || 0);
            item.slotG.dataset.morphScale = String(toScale);
            item.slotG.dataset.morphDy = String(toDy);
            item.slotG.dataset.morphPad = String(item.toPadX);
          });
          g.classList.remove("script-morph__row--casefold");
          if (!this._still(token)) {
            resolve();
            return;
          }
          if (doSettle) {
            this._settleMetrics(to, token).then(resolve);
          } else {
            resolve();
          }
        };

        const startMorphFrames = () => {
          if (!this._still(token)) {
            resolve();
            return;
          }
          step = 0;
          stepStarted = performance.now();
          pauseAnchor = 0;
          this._raf(token, morphFrame);
        };

        const morphFrame = (now) => {
          if (!this._still(token)) {
            resolve();
            return;
          }
          if (this._paused) {
            if (!pauseAnchor) pauseAnchor = now;
            this._raf(token, morphFrame);
            return;
          }
          if (pauseAnchor) {
            stepStarted += now - pauseAnchor;
            pauseAnchor = 0;
          }
          if (step >= visualOrder.length) {
            paint();
            finishMorph();
            return;
          }
          const visual = visualOrder[step];
          const local = Math.min(1, Math.max(0, (now - stepStarted) / slotMs));
          progress[visual] = easeInOut(local);
          paint();
          const doneSteps = step;
          this._playheadMs =
            morphPhaseOrigin +
            (needsSlotPrep && !opts.skipPrep ? prepMs : 0) +
            doneSteps * (slotMs + gapMs) +
            local * slotMs;
          this._syncTransport();
          if (local < 1) {
            this._raf(token, morphFrame);
            return;
          }
          progress[visual] = 1;
          step += 1;
          if (step >= visualOrder.length) {
            paint();
            this._phaseStartMs = morphPhaseOrigin + est;
            this._playheadMs = this._phaseStartMs;
            this._syncTransport();
            finishMorph();
            return;
          }
          // Gap between slots (pause-aware).
          let gapElapsed = 0;
          let gapLast = performance.now();
          const gapFrame = (gNow) => {
            if (!this._still(token)) {
              resolve();
              return;
            }
            if (this._paused) {
              gapLast = gNow;
              this._raf(token, gapFrame);
              return;
            }
            gapElapsed += gNow - gapLast;
            gapLast = gNow;
            this._playheadMs =
              morphPhaseOrigin +
              (needsSlotPrep && !opts.skipPrep ? prepMs : 0) +
              step * slotMs +
              (step - 1) * gapMs +
              Math.min(gapElapsed, gapMs);
            this._syncTransport();
            if (gapElapsed < gapMs) {
              this._raf(token, gapFrame);
              return;
            }
            stepStarted = performance.now();
            pauseAnchor = 0;
            this._raf(token, morphFrame);
          };
          this._raf(token, gapFrame);
        };

        /** Ease from continuous packing into to-sized slot cells, then morph. */
        const runSlotPrep = () => {
          if (!this._still(token)) {
            resolve();
            return;
          }
          if (!needsSlotPrep || opts.skipPrep) {
            groups.forEach((item) => {
              item.fixedX = item.endX;
              item.slotG.setAttribute("transform", `translate(${item.endX}, 0)`);
              item.pathFrom.setAttribute(
                "transform",
                `translate(${item.fromPadX}, 0)`
              );
              item.box.setAttribute(
                "width",
                String(item.endCellW + boxPad * 2)
              );
              if (item.changed) item.box.style.opacity = "0.35";
            });
            setViewBox(this.svg, endMetrics);
            startMorphFrames();
            return;
          }

          const prevPhase =
            this.phaseEl && !this.phaseEl.hidden ? this.phaseEl.textContent : "";
          if (this.fullscreen) this._setPhase("Slot alignment");
          let prepElapsed = 0;
          let prepLast = performance.now();
          let prepPause = 0;
          const prepFrame = (now) => {
            if (!this._still(token)) {
              resolve();
              return;
            }
            if (this._paused) {
              if (!prepPause) prepPause = now;
              this._raf(token, prepFrame);
              return;
            }
            if (prepPause) {
              prepLast += now - prepPause;
              prepPause = 0;
            }
            prepElapsed += now - prepLast;
            prepLast = now;
            const raw = Math.min(1, prepElapsed / prepMs);
            const t = easeInOut(raw);
            groups.forEach((item) => {
              const x = item.startX + (item.endX - item.startX) * t;
              const cellW =
                item.startCellW + (item.endCellW - item.startCellW) * t;
              const fromPad = item.fromPadX * t;
              item.fixedX = x;
              item.slotG.setAttribute("transform", `translate(${x}, 0)`);
              item.pathFrom.setAttribute("transform", `translate(${fromPad}, 0)`);
              // Keep invisible `to` glyph centered in the growing cell.
              const toPad = (cellW - item.advB) / 2;
              item.pathTo.setAttribute(
                "transform",
                `translate(${toPad}, ${toDy}) scale(${toScale})`
              );
              item.box.setAttribute("width", String(cellW + boxPad * 2));
              if (item.changed) {
                item.box.style.opacity = String(0.35 * t);
              }
            });
            const width =
              startMetrics.width + (endMetrics.width - startMetrics.width) * t;
            setViewBox(this.svg, {
              minY: endMetrics.minY,
              maxY: endMetrics.maxY,
              height: endMetrics.height,
              width,
            });
            this._playheadMs = morphPhaseOrigin + prepElapsed;
            this._syncTransport();
            if (raw < 1) {
              this._raf(token, prepFrame);
              return;
            }
            groups.forEach((item) => {
              item.fixedX = item.endX;
              item.toPadX = (item.endCellW - item.advB) / 2;
              item.pathFrom.setAttribute(
                "transform",
                `translate(${item.fromPadX}, 0)`
              );
              item.pathTo.setAttribute(
                "transform",
                `translate(${item.toPadX}, ${toDy}) scale(${toScale})`
              );
              if (item.changed) item.box.style.opacity = "0.35";
            });
            setViewBox(this.svg, endMetrics);
            if (!this._still(token)) {
              resolve();
              return;
            }
            if (this.fullscreen) {
              this._setPhase(prevPhase || "Grapheme correspondence");
            }
            startMorphFrames();
          };
          this._raf(token, prepFrame);
        };

        runSlotPrep();
      });
    }

    /**
     * Final phase: fade slot scaffolding and ease glyphs into continuous metrics.
     * Skips when there is nothing left to collapse (no duplicate motion).
     */
    _settleMetrics(script, token) {
      if (!script) return Promise.resolve();
      if (token == null) token = this._animToken;
      if (!this._still(token)) return Promise.resolve();

      // Cursive end-state: tighten onto the joined outline.
      if (
        script.compose &&
        script.compose.mode === "cursive" &&
        script.joined &&
        this.svg.querySelector(".script-morph__joined")
      ) {
        return this._settleJoined(script, token);
      }

      const row = this.svg.querySelector(".script-morph__row");
      if (!row) return Promise.resolve();

      const pairs = [...row.querySelectorAll(".script-morph__slot-pair")];
      if (!pairs.length) return Promise.resolve();

      const items = pairs
        .map((slotG) => {
          const logical = parseInt(slotG.dataset.slot, 10);
          const path =
            slotG.querySelector("path.script-morph__slot") ||
            slotG.querySelector("path");
          const box = slotG.querySelector(".script-morph__slot-box");
          const gm = /translate\(([-\d.]+)/.exec(slotG.getAttribute("transform") || "");
          const startX = gm ? parseFloat(gm[1]) : 0;
          const startScale = parseFloat(slotG.dataset.morphScale || "1") || 1;
          const startDy = parseFloat(slotG.dataset.morphDy || "0") || 0;
          let startPad = parseFloat(slotG.dataset.morphPad || "");
          if (!isFinite(startPad) && path) {
            const pm = /translate\(([-\d.]+)/.exec(path.getAttribute("transform") || "");
            startPad = pm ? parseFloat(pm[1]) : 0;
          }
          if (!isFinite(startPad)) startPad = 0;
          let advance = parseFloat(slotG.dataset.advance || "");
          if (!isFinite(advance)) {
            const slot = script.slots[logical];
            advance = slot ? slot.advance || 0 : 0;
          }
          const boxW = box ? parseFloat(box.getAttribute("width") || "0") : 0;
          const startCellW =
            boxW > 0 ? Math.max(boxW - 56, advance * startScale) : Math.max(advance * startScale, 1);
          return {
            slotG,
            path,
            box,
            logical,
            startX,
            startPad,
            startCellW,
            startScale,
            startDy,
            advance,
          };
        })
        .sort((a, b) => a.startX - b.startX || a.logical - b.logical);

      let tx = 0;
      items.forEach((item) => {
        item.endX = tx;
        item.endPad = 0;
        item.endCellW = item.advance || 0;
        tx += item.endCellW;
      });

      const moved = items.some(
        (item) =>
          Math.abs(item.startX - item.endX) > 0.5 ||
          Math.abs(item.startPad - item.endPad) > 0.5 ||
          Math.abs(item.startCellW - item.endCellW) > 0.5 ||
          Math.abs(item.startScale - 1) > 0.001 ||
          Math.abs(item.startDy) > 0.5
      );
      const visibleBoxes = items.filter((item) => {
        if (!item.box || !item.box.isConnected) return false;
        const op = item.box.style.opacity;
        return op === "" || parseFloat(op) > 0.02;
      });
      if (!moved && !visibleBoxes.length) {
        items.forEach((item) => {
          if (item.box) item.box.remove();
          if (item.path) {
            item.path.setAttribute("transform", "translate(0, 0)");
            item.path.classList.remove("script-morph__slot--settling");
          }
          item.slotG.setAttribute("transform", `translate(${item.endX}, 0)`);
        });
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        this._beginPhase("Metric settling");

        let minY = Infinity;
        let maxY = -Infinity;
        items.forEach((item) => {
          const db = item.slotG.dataset.bounds;
          const slot = script.slots[item.logical];
          const bounds = db
            ? db.split(",").map(Number)
            : slot && slot.bounds
              ? slot.bounds
              : null;
          if (bounds && bounds.length >= 4) {
            minY = Math.min(minY, bounds[1]);
            maxY = Math.max(maxY, bounds[3]);
          }
        });
        if (!isFinite(minY)) {
          const m = displayMetrics(script);
          minY = m.minY;
          maxY = m.maxY;
        }
        let endMetrics = {
          minY,
          maxY,
          width: Math.max(tx, 1),
          height: Math.max(maxY - minY, 1),
        };
        // Prefer optical framing for Arabic so settle doesn't shrink the name.
        if (script.family === "arabic") {
          const optical = displayMetrics(script);
          endMetrics = {
            ...optical,
            width: Math.max(tx, optical.width, 1),
          };
        }

        const vb = (this.svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
        const startVB = { minY: vb[1], width: vb[2], height: vb[3] };

        items.forEach((item) => {
          if (item.path) item.path.classList.add("script-morph__slot--settling");
          if (item.box) item.box.classList.remove("is-active");
        });

        this._animate(token, SETTLE_MS, (t) => {
          items.forEach((item) => {
            const x = item.startX + (item.endX - item.startX) * t;
            const cellW = item.startCellW + (item.endCellW - item.startCellW) * t;
            const padX = item.startPad + (item.endPad - item.startPad) * t;
            const scale = item.startScale + (1 - item.startScale) * t;
            const dy = item.startDy * (1 - t);
            item.slotG.setAttribute("transform", `translate(${x}, 0)`);
            if (item.path) {
              item.path.setAttribute(
                "transform",
                Math.abs(scale - 1) < 0.0005 && Math.abs(dy) < 0.05
                  ? `translate(${padX}, 0)`
                  : `translate(${padX}, ${dy}) scale(${scale})`
              );
            }
            if (item.box) {
              item.box.setAttribute("width", String(cellW + 56));
              item.box.style.opacity = String(0.35 * (1 - t));
            }
          });
          const width = startVB.width + (endMetrics.width - startVB.width) * t;
          const minYv = startVB.minY + (endMetrics.minY - startVB.minY) * t;
          const height = startVB.height + (endMetrics.height - startVB.height) * t;
          setViewBox(this.svg, { minY: minYv, maxY: minYv + height, width, height });
        }).then((ok) => {
          if (!ok) {
            resolve();
            return;
          }
          items.forEach((item) => {
            if (item.box) item.box.remove();
            if (item.path) {
              item.path.setAttribute("transform", "translate(0, 0)");
              item.path.classList.remove(
                "script-morph__slot--to",
                "script-morph__slot--from",
                "script-morph__slot--settling"
              );
              item.path.classList.add("script-morph__slot");
              item.path.removeAttribute("style");
            }
            item.slotG.setAttribute("transform", `translate(${item.endX}, 0)`);
            item.slotG.classList.remove("is-unchanged");
            delete item.slotG.dataset.morphScale;
            delete item.slotG.dataset.morphDy;
            delete item.slotG.dataset.morphPad;
          });
          setViewBox(this.svg, endMetrics);
          resolve();
        });
      });
    }

    /** After cursive joining: drop isol scaffolding and ease onto the joined word. */
    _settleJoined(script, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        const joined = script.joined;
        if (!joined || !joined.path) {
          this._renderScript(script.id, false, { joined: true });
          resolve();
          return;
        }

        const row = this.svg.querySelector(".script-morph__row");
        const joinedPaths = [
          ...this.svg.querySelectorAll(".script-morph__joined"),
        ].filter((el) => parseFloat(el.style.opacity || "1") > 0.5);
        const finalJoined =
          joinedPaths[joinedPaths.length - 1] ||
          this.svg.querySelector(".script-morph__joined");
        if (!finalJoined || !row) {
          this._renderScript(script.id, false, { joined: true });
          resolve();
          return;
        }

        // Already a single clean joined render — nothing to animate.
        const isol = [...row.querySelectorAll(".script-morph__slot")];
        const hasIsol = isol.some((el) => parseFloat(el.style.opacity || "1") > 0.05);
        const vb = (this.svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
        const endMetrics = displayMetrics({
          ...script,
          slots: [
            {
              empty: false,
              advance: joined.advance || 0,
              bounds: joined.bounds || [0, 0, 1, 800],
            },
          ],
        });
        endMetrics.width = Math.max(
          joined.advance || endMetrics.width,
          1
        );
        const startVB = { minY: vb[1], width: vb[2], height: vb[3] };
        const needsVB =
          Math.abs(startVB.width - endMetrics.width) > 1 ||
          Math.abs(startVB.height - endMetrics.height) > 1 ||
          Math.abs(startVB.minY - endMetrics.minY) > 1;

        if (!hasIsol && !needsVB) {
          this._renderScript(script.id, false, { joined: true });
          resolve();
          return;
        }

        this._beginPhase("Metric settling");
        const jm = /translate\(([-\d.]+)/.exec(finalJoined.getAttribute("transform") || "");
        const startX = jm ? parseFloat(jm[1]) : 0;
        const endX = 0;

        this._animate(token, SETTLE_MS, (t) => {
          isol.forEach((el) => {
            el.style.opacity = String(
              Math.max(0, parseFloat(el.style.opacity || "1") * (1 - t))
            );
          });
          finalJoined.style.opacity = "1";
          finalJoined.setAttribute(
            "transform",
            `translate(${startX + (endX - startX) * t}, 0)`
          );
          const width = startVB.width + (endMetrics.width - startVB.width) * t;
          const minY = startVB.minY + (endMetrics.minY - startVB.minY) * t;
          const height = startVB.height + (endMetrics.height - startVB.height) * t;
          setViewBox(this.svg, { minY, maxY: minY + height, width, height });
        }).then((ok) => {
          if (ok) this._renderScript(script.id, false, { joined: true });
          resolve();
        });
      });
    }

    /** Animate characters swapping into reversed string order (no glyph flip). */
    _reverseOrder(script, duration, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        this._renderScript(script.id, false, { joined: false, reversed: false });
        const paths = [...this.svg.querySelectorAll(".script-morph__slot")];
        const n = script.slots.length;
        const { xs: fromXs, width } = slotOrigins(script);

        // Target x for logical slot i after reverse: sum of advances of
        // visual predecessors (logical n-1, n-2, … down to i+1).
        const toXs = new Array(n);
        let x = 0;
        for (let visual = 0; visual < n; visual++) {
          const logical = n - 1 - visual;
          toXs[logical] = x;
          x += script.slots[logical].advance || 0;
        }

        setViewBox(this.svg, displayMetrics(script));
        this._animate(token, duration, (t) => {
          paths.forEach((el) => {
            const i = parseInt(el.dataset.slot, 10);
            const xNow = fromXs[i] + (toXs[i] - fromXs[i]) * t;
            el.setAttribute("transform", `translate(${xNow}, 0)`);
          });
        }).then((ok) => {
          if (ok) {
            this._renderScript(script.id, false, { joined: false, reversed: true });
          }
          resolve();
        });
        void width;
      });
    }

    /** Un-reverse: RTL visual order back to LTR logical order. */
    _unreverseOrder(script, duration, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        this._renderScript(script.id, false, { joined: false, reversed: true });
        const paths = [...this.svg.querySelectorAll(".script-morph__slot")];
        const n = script.slots.length;
        const { xs: ltrXs } = slotOrigins(script);

        const fromXs = new Array(n);
        let x = 0;
        for (let visual = 0; visual < n; visual++) {
          const logical = n - 1 - visual;
          fromXs[logical] = x;
          x += script.slots[logical].advance || 0;
        }

        setViewBox(this.svg, displayMetrics(script));
        this._animate(token, duration, (t) => {
          paths.forEach((el) => {
            const i = parseInt(el.dataset.slot, 10);
            const xNow = fromXs[i] + (ltrXs[i] - fromXs[i]) * t;
            el.setAttribute("transform", `translate(${xNow}, 0)`);
          });
        }).then((ok) => {
          if (ok) {
            this._renderScript(script.id, false, { joined: false, reversed: false });
          }
          resolve();
        });
      });
    }

    /**
     * Animate post-morph slot scaffolding into the spaced isolated layout
     * used by cursive joining (no instant jump).
     */
    _spreadForCursiveJoin(script, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        const n = script.slots.length;
        const isolGap = 120;
        const endXs = new Array(n);
        let xCursor = 0;
        for (let logical = n - 1; logical >= 0; logical--) {
          endXs[logical] = xCursor;
          xCursor += (script.slots[logical].advance || 0) + isolGap;
        }
        const endMetrics = displayMetrics(script);
        endMetrics.width = Math.max(endMetrics.width, xCursor, 1);

        const row = this.svg.querySelector(".script-morph__row");
        const pairs = row
          ? [...row.querySelectorAll(".script-morph__slot-pair")]
          : [];

        // Nothing to interpolate — drop straight into isol render.
        if (!pairs.length) {
          this._renderIsolatedForJoin(script);
          resolve();
          return;
        }

        const items = pairs
          .map((slotG) => {
            const logical = parseInt(slotG.dataset.slot, 10);
            const path =
              slotG.querySelector("path.script-morph__slot") ||
              slotG.querySelector("path");
            const box = slotG.querySelector(".script-morph__slot-box");
            const gm = /translate\(([-\d.]+)/.exec(
              slotG.getAttribute("transform") || ""
            );
            const startX = gm ? parseFloat(gm[1]) : 0;
            const startScale = parseFloat(slotG.dataset.morphScale || "1") || 1;
            const startDy = parseFloat(slotG.dataset.morphDy || "0") || 0;
            let startPad = parseFloat(slotG.dataset.morphPad || "");
            if (!isFinite(startPad) && path) {
              const pm = /translate\(([-\d.]+)/.exec(
                path.getAttribute("transform") || ""
              );
              startPad = pm ? parseFloat(pm[1]) : 0;
            }
            if (!isFinite(startPad)) startPad = 0;
            const advance = script.slots[logical]
              ? script.slots[logical].advance || 0
              : 0;
            const boxW = box ? parseFloat(box.getAttribute("width") || "0") : 0;
            const startCellW =
              boxW > 0
                ? Math.max(boxW - 56, advance * startScale)
                : Math.max(advance * startScale, 1);
            return {
              slotG,
              path,
              box,
              logical,
              startX,
              startPad,
              startCellW,
              startScale,
              startDy,
              endX: endXs[logical] || 0,
              endPad: 0,
              endCellW: advance,
              advance,
            };
          })
          .sort((a, b) => a.startX - b.startX || a.logical - b.logical);

        const moved = items.some(
          (item) =>
            Math.abs(item.startX - item.endX) > 0.5 ||
            Math.abs(item.startPad) > 0.5 ||
            Math.abs(item.startCellW - item.endCellW) > 0.5 ||
            Math.abs(item.startScale - 1) > 0.001 ||
            Math.abs(item.startDy) > 0.5
        );
        const hasBoxes = items.some(
          (item) =>
            item.box &&
            item.box.isConnected &&
            (item.box.style.opacity === "" ||
              parseFloat(item.box.style.opacity) > 0.02)
        );

        if (!moved && !hasBoxes) {
          this._renderIsolatedForJoin(script);
          resolve();
          return;
        }

        const vb = (this.svg.getAttribute("viewBox") || "0 0 1 1")
          .split(/\s+/)
          .map(Number);
        const startVB = { minY: vb[1], width: vb[2], height: vb[3] };

        items.forEach((item) => {
          if (item.path) {
            item.path.classList.add(
              "script-morph__slot--unjoined",
              "script-morph__slot--settling"
            );
          }
          if (item.box) item.box.classList.remove("is-active");
        });
        if (row) row.classList.add("script-morph__row--joining");

        this._animate(token, SPREAD_MS, (t) => {
          items.forEach((item) => {
            const x = item.startX + (item.endX - item.startX) * t;
            const cellW =
              item.startCellW + (item.endCellW - item.startCellW) * t;
            const padX = item.startPad * (1 - t);
            const scale = item.startScale + (1 - item.startScale) * t;
            const dy = item.startDy * (1 - t);
            item.slotG.setAttribute("transform", `translate(${x}, 0)`);
            if (item.path) {
              item.path.setAttribute(
                "transform",
                Math.abs(scale - 1) < 0.0005 && Math.abs(dy) < 0.05
                  ? `translate(${padX}, 0)`
                  : `translate(${padX}, ${dy}) scale(${scale})`
              );
            }
            if (item.box) {
              item.box.setAttribute("width", String(cellW + 56));
              item.box.style.opacity = String(0.35 * (1 - t));
            }
          });
          const width = startVB.width + (endMetrics.width - startVB.width) * t;
          const minY = startVB.minY + (endMetrics.minY - startVB.minY) * t;
          const height =
            startVB.height + (endMetrics.height - startVB.height) * t;
          setViewBox(this.svg, {
            minY,
            maxY: minY + height,
            width,
            height,
          });
        }).then((ok) => {
          if (ok) this._renderIsolatedForJoin(script);
          resolve();
        });
      });
    }

    /** Build the spaced isolated letter row join will absorb from. */
    _renderIsolatedForJoin(script) {
      const n = script.slots.length;
      const isolGap = 120;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("script-morph__row", "script-morph__row--joining");
      let xCursor = 0;
      for (let logical = n - 1; logical >= 0; logical--) {
        const slot = script.slots[logical];
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.classList.add("script-morph__slot", "script-morph__slot--unjoined");
        path.dataset.slot = String(logical);
        path.setAttribute("d", slot.path || pointsToPath(slot.points));
        path.setAttribute("transform", `translate(${xCursor}, 0)`);
        g.appendChild(path);
        xCursor += (slot.advance || 0) + isolGap;
      }
      this.svg.replaceChildren(g);
      this.svg.style.transform = "scale(1, -1)";
      setViewBox(this.svg, displayMetrics(script));
    }

    /**
     * One-by-one RTL combining with fixed letter positions.
     * Each new joined form is centered on the midpoint of the two pieces
     * being combined — other letters stay put (gaps can remain).
     */
    _joinOneByOne(script, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        const steps = script.join_steps || (script.joined ? [script.joined] : []);
        if (!steps.length) {
          resolve();
          return;
        }

        const n = script.slots.length;
        const isolGap = 120;

        // Prefer continuing from the already-spread isol row.
        let g = this.svg.querySelector(".script-morph__row--joining");
        let isol = [];
        if (g) {
          const paths = [...g.querySelectorAll(".script-morph__slot--unjoined")];
          if (paths.length === n) {
            let xCursor = 0;
            for (let logical = n - 1; logical >= 0; logical--) {
              const slot = script.slots[logical];
              const path = paths.find(
                (p) => parseInt(p.dataset.slot, 10) === logical
              );
              if (!path) {
                isol = [];
                break;
              }
              const adv = slot.advance || 0;
              const x = xCursor;
              path.setAttribute("transform", `translate(${x}, 0)`);
              path.style.opacity = "1";
              isol.push({
                path,
                slot,
                logical,
                x,
                advance: adv,
                center: x + adv / 2,
              });
              xCursor += adv + isolGap;
            }
          }
        }

        if (!isol.length) {
          this._renderIsolatedForJoin(script);
          g = this.svg.querySelector(".script-morph__row--joining");
          isol = [];
          let xCursor = 0;
          for (let logical = n - 1; logical >= 0; logical--) {
            const slot = script.slots[logical];
            const path = g.querySelector(`[data-slot="${logical}"]`);
            const adv = slot.advance || 0;
            isol.push({
              path,
              slot,
              logical,
              x: xCursor,
              advance: adv,
              center: xCursor + adv / 2,
            });
            xCursor += adv + isolGap;
          }
        }

        const joinedA = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const joinedB = document.createElementNS("http://www.w3.org/2000/svg", "path");
        joinedA.classList.add("script-morph__joined");
        joinedB.classList.add("script-morph__joined");
        joinedA.style.opacity = "0";
        joinedB.style.opacity = "0";
        g.appendChild(joinedA);
        g.appendChild(joinedB);
        this.svg.style.transform = "scale(1, -1)";

        // Freeze the optically-framed isolated layout for the whole combine.
        const lockedMetrics = displayMetrics(script);
        setViewBox(this.svg, lockedMetrics);

        // Anchor the joined cluster's RIGHT edge so it grows leftward (RTL)
        // instead of walking left via midpoint averaging.
        const first = isol.find((i) => i.logical === 0);
        let clusterRight = first ? first.x + first.advance : lockedMetrics.width;

        const placeJoined = (el, stepOutline, rightEdge, opacity) => {
          if (!stepOutline || !stepOutline.path || rightEdge == null) {
            el.style.opacity = "0";
            return;
          }
          const adv = stepOutline.advance || 0;
          el.setAttribute("d", stepOutline.path);
          el.setAttribute("transform", `translate(${rightEdge - adv}, 0)`);
          el.style.opacity = String(opacity);
        };

        const paint = (absorbed, t) => {
          isol.forEach((item) => {
            if (item.logical > absorbed) {
              item.path.style.opacity = "1";
              item.path.setAttribute("transform", `translate(${item.x}, 0)`);
            } else if (item.logical < absorbed) {
              item.path.style.opacity = "0";
            }
          });

          const absorbing = isol.find((i) => i.logical === absorbed);
          const prev = absorbed > 0 ? steps[absorbed - 1] : null;
          const next = absorbed < steps.length ? steps[absorbed] : null;

          if (!absorbing || !next) {
            if (prev) {
              placeJoined(joinedA, prev, clusterRight, 1);
              joinedB.style.opacity = "0";
            }
            return;
          }

          absorbing.path.style.opacity = String(1 - t);
          absorbing.path.setAttribute("transform", `translate(${absorbing.x}, 0)`);

          if (!prev) {
            // First letter: fade into joined form in place (same right edge).
            placeJoined(joinedA, next, clusterRight, t);
            joinedB.style.opacity = "0";
            return;
          }

          // Keep right edge fixed; new cursive form grows further left.
          placeJoined(joinedA, prev, clusterRight, 1 - t);
          placeJoined(joinedB, next, clusterRight, t);
        };

        paint(0, 0);
        let step = 0;
        const joinStepMs = this._ms(JOIN_STEP_MS);
        const runStep = () => {
          if (!this._still(token)) {
            resolve();
            return;
          }
          if (step >= n) {
            paint(n, 1);
            resolve();
            return;
          }
          let elapsed = 0;
          let last = performance.now();
          const frame = (now) => {
            if (!this._still(token)) {
              resolve();
              return;
            }
            if (this._paused) {
              last = now;
              this._raf(token, frame);
              return;
            }
            elapsed += now - last;
            last = now;
            const local = Math.min(1, elapsed / joinStepMs);
            paint(step, easeInOut(local));
            this._playheadMs = this._phaseStartMs + elapsed;
            this._syncTransport();
            if (local < 1) {
              this._raf(token, frame);
              return;
            }
            paint(step, 1);
            this._phaseStartMs += joinStepMs;
            step += 1;
            if (step >= n) {
              resolve();
              return;
            }
            this._wait(token, JOIN_GAP_MS).then((ok) => {
              if (!ok) {
                resolve();
                return;
              }
              runStep();
            });
          };
          this._raf(token, frame);
        };
        runStep();
      });
    }

    async _cursiveTransition(from, to, token) {
      const entering = to.compose && to.compose.mode === "cursive";
      if (entering) {
        this._beginPhase("Reading-order reversal");
        await this._reverseOrder(from, REVERSE_MS, token);
        if (!this._still(token)) return;
        this._beginPhase("Grapheme correspondence");
        await this._morphSlots(from, to, true, { settle: false, token });
        if (!this._still(token)) return;
        this._beginPhase("Isolation spacing");
        await this._spreadForCursiveJoin(to, token);
        if (!this._still(token)) return;
        this._beginPhase(to.compose.term || "Cursive joining");
        await this._joinOneByOne(to, token);
      } else {
        this._beginPhase("Cursive segregation");
        this._renderScript(from.id, false, { joined: false, reversed: true });
        await this._wait(token, 80);
        if (!this._still(token)) return;
        this._beginPhase("Grapheme correspondence");
        await this._morphSlots(from, to, true, { settle: false, token });
        if (!this._still(token)) return;
        this._beginPhase("Reading-order reversal");
        await this._unreverseOrder(to, REVERSE_MS, token);
      }
    }

    /**
     * Data-driven mark attachment (anusvāra, pulli, …): merge slot pairs in place.
     */
    async _composeAttach(script, token) {
      const steps = (script.compose && script.compose.steps) || [];
      for (const step of steps) {
        if (!this._still(token)) return;
        this._beginPhase(step.term || script.compose.term || "Mark attachment");
        await this._attachMerge(script, step, token);
      }
    }

    _attachMerge(script, step, token) {
      return new Promise((resolve) => {
        if (token == null) token = this._animToken;
        if (!this._still(token)) {
          resolve();
          return;
        }
        const idxs = step.slots || [];
        if (idxs.length < 2 || !step.path) {
          resolve();
          return;
        }
        const baseI = idxs[0];
        const markI = idxs[1];
        const row = this.svg.querySelector(".script-morph__row");
        if (!row) {
          resolve();
          return;
        }

        const baseG = row.querySelector(`[data-slot="${baseI}"]`);
        const markG = row.querySelector(`[data-slot="${markI}"]`);
        if (!baseG || !markG) {
          resolve();
          return;
        }

        const basePath =
          baseG.querySelector("path.script-morph__slot") ||
          baseG.querySelector("path");
        const markPath =
          markG.querySelector("path.script-morph__slot") ||
          markG.querySelector("path");

        const baseM = /translate\(([-\d.]+)/.exec(baseG.getAttribute("transform") || "");
        const markM = /translate\(([-\d.]+)/.exec(markG.getAttribute("transform") || "");
        const baseX = baseM ? parseFloat(baseM[1]) : 0;
        const markX = markM ? parseFloat(markM[1]) : 0;
        // Keep the morph-time size match so attach doesn't pop to a different em.
        const scale = parseFloat(baseG.dataset.morphScale || "1") || 1;
        const dy = parseFloat(baseG.dataset.morphDy || "0") || 0;
        const pad = parseFloat(baseG.dataset.morphPad || "0") || 0;
        const fitted = (px, py) =>
          Math.abs(scale - 1) < 0.0005 && Math.abs(dy) < 0.05
            ? `translate(${px}, 0)`
            : `translate(${px}, ${py}) scale(${scale})`;

        const combined = document.createElementNS("http://www.w3.org/2000/svg", "path");
        combined.classList.add("script-morph__slot", "script-morph__composed");
        combined.setAttribute("d", step.path);
        combined.style.opacity = "0";
        // Sit on the base slot (still in from-fitted space until metric settle).
        combined.setAttribute("transform", fitted(baseX + pad, dy));
        row.appendChild(combined);

        this._animate(token, JOIN_STEP_MS, (t) => {
          if (basePath) basePath.style.opacity = String(1 - t);
          if (markPath) markPath.style.opacity = String(1 - t);
          markG.style.opacity = String(1 - t);
          combined.style.opacity = String(t);
          const x = markX + (baseX - markX) * t;
          markG.setAttribute("transform", `translate(${x}, 0)`);
          combined.setAttribute("transform", fitted(baseX + pad, dy));
        }).then((ok) => {
          if (!ok) {
            resolve();
            return;
          }
          markG.remove();
          if (basePath) basePath.remove();
          combined.style.opacity = "1";
          baseG.appendChild(combined);
          combined.removeAttribute("style");
          combined.setAttribute("transform", fitted(pad, dy));
          baseG.setAttribute("transform", `translate(${baseX}, 0)`);
          baseG.dataset.advance = String(step.advance || 0);
          baseG.dataset.morphPad = String(pad);
          if (step.bounds) baseG.dataset.bounds = step.bounds.join(",");
          resolve();
        });
      });
    }

    openFullscreen() {
      if (this.fullscreen || !this.active) return;
      this.fullscreen = true;

      this.overlay = document.createElement("div");
      this.overlay.className = "script-morph-overlay";
      const chooserItems = this.carousel
        .map((id) => {
          const s = scriptById(this.data, id);
          const label = s ? s.label : id;
          return `<li><button type="button" class="script-morph-chooser__btn" data-script="${id}">${label}</button></li>`;
        })
        .join("");
      this.overlay.innerHTML = `
        <button type="button" class="script-morph-overlay__close" aria-label="Close fullscreen">×</button>
        <div class="script-morph-overlay__main">
          <div class="script-morph-overlay__stage"></div>
          <div class="script-morph__transport" hidden>
            <button type="button" class="script-morph__play" aria-label="Pause">❚❚</button>
            <div class="script-morph__seek-wrap">
              <div class="script-morph__markers" aria-hidden="true"></div>
              <input type="range" class="script-morph__seek" min="0" max="1000" value="0" step="1" aria-label="Seek morph timeline" />
            </div>
          </div>
        </div>
        <aside class="script-morph-chooser" aria-label="Choose script">
          <p class="script-morph-chooser__title">scripts</p>
          <ul class="script-morph-chooser__list">${chooserItems}</ul>
        </aside>
      `;
      document.body.appendChild(this.overlay);
      document.body.classList.add("script-morph-open");

      const stageMount = this.overlay.querySelector(".script-morph-overlay__stage");
      this._fsHost = document.createElement("div");
      this._fsHost.className = "script-morph-host is-active";
      stageMount.appendChild(this._fsHost);

      this._placeholder = document.createComment("script-morph-fs");
      this.root.parentNode.insertBefore(this._placeholder, this.root);
      this._fsHost.appendChild(this.root);
      this.root.classList.add("script-morph--fullscreen");
      this.btnFs.hidden = true;

      this.transportEl = this.overlay.querySelector(".script-morph__transport");
      this.transportEl.hidden = false;
      this.playBtn = this.overlay.querySelector(".script-morph__play");
      this.seekEl = this.overlay.querySelector(".script-morph__seek");
      this._syncPlayButton();

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
      });
      const commitSeek = () => {
        if (!this._seeking) return;
        const ms = parseFloat(this.seekEl.value) || 0;
        this._onSeekInput(ms, true);
      };
      this.seekEl.addEventListener("change", commitSeek);
      this.seekEl.addEventListener("pointerup", commitSeek);
      this.transportEl.querySelector(".script-morph__markers").addEventListener("click", (e) => {
        const marker = e.target.closest(".script-morph__marker");
        if (!marker) return;
        const ms = parseFloat(marker.getAttribute("data-ms")) || 0;
        this._onSeekInput(ms, true);
      });

      this.chooser = this.overlay.querySelector(".script-morph-chooser");
      this.chooser.addEventListener("click", (e) => {
        const btn = e.target.closest(".script-morph-chooser__btn");
        if (!btn) return;
        this.goToScriptId(btn.getAttribute("data-script"));
      });
      this._syncChooser();

      if (this._timeline) this._installTimeline(this._timeline);

      this.overlay.querySelector(".script-morph-overlay__close").addEventListener("click", () => {
        this.closeFullscreen();
      });
      this.overlay.querySelector(".script-morph-overlay__close").focus();
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
      this._setPhase("");
      if (this._placeholder && this._placeholder.parentNode) {
        this._placeholder.parentNode.insertBefore(this.root, this._placeholder);
        this._placeholder.remove();
      }
      if (this.overlay) this.overlay.remove();
      document.body.classList.remove("script-morph-open");
      this.overlay = null;
      if (this.active) this.stage.focus();
    }
  }

  async function bootHost(host) {
    const id = host.getAttribute("data-phrase");
    const url =
      host.getAttribute("data-src") ||
      `${window.scriptMorphBase || ""}/assets/data/script_morph/${id}.json`;

    let data = null;
    let morph = null;
    let loading = null;

    const ensure = async () => {
      if (morph) return morph;
      if (loading) return loading;
      loading = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.statusText);
        data = await res.json();
        morph = new ScriptMorph(host, data);
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

    label.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
    });
    label.addEventListener("pointermove", (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
    });

    const hint = host.querySelector(".script-morph-hint");
    // Show hint once per page load; hide after first activation.
    if (hint) hint.classList.remove("is-hidden");

    const activate = async () => {
      try {
        const m = await ensure();
        m.activate();
      } catch (_) {}
    };

    label.addEventListener("click", (e) => {
      if (moved) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.toString() && label.contains(sel.anchorNode)) return;
      e.preventDefault();
      activate();
    });
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  }

  function boot() {
    document.querySelectorAll(".script-morph-host[data-phrase]").forEach((host) => {
      bootHost(host);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
