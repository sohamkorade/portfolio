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
  const REVERSE_MS = 1100;
  const JOIN_STEP_MS = 1400; // per-letter combine into cursive (slow)
  const JOIN_GAP_MS = 220;
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

  function setViewBox(svg, metrics) {
    const pad = metrics.height * 0.12;
    svg.setAttribute(
      "viewBox",
      `0 ${metrics.minY - pad} ${Math.max(metrics.width, 1)} ${metrics.height + pad * 2}`
    );
  }

  function unionMetrics(a, b) {
    const ga = a.family === "arabic" ? 120 : 0;
    const gb = b.family === "arabic" ? 120 : 0;
    const ma = slotBounds(a, { isolGap: ga });
    const mb = slotBounds(b, { isolGap: gb });
    const minY = Math.min(ma.minY, mb.minY);
    const maxY = Math.max(ma.maxY, mb.maxY);
    return {
      minY,
      maxY,
      width: Math.max(ma.width, mb.width, 1),
      height: Math.max(maxY - minY, 1),
    };
  }

  class ScriptMorph {
    constructor(host, data) {
      this.host = host;
      this.label = host.querySelector(".script-morph-label");
      this.data = data;
      this.carousel = data.carousel.filter((id) => scriptById(data, id));
      this.index = this._loadIndex();
      this.animating = false;
      this.active = false;
      this.fullscreen = false;
      this._build();
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
        <button type="button" class="script-morph__btn script-morph__btn--fullscreen" aria-label="Expand script morph">⛶</button>
        <button type="button" class="script-morph__btn script-morph__btn--exit" aria-label="Close script morph">×</button>
        <span class="script-morph__phase" aria-live="polite" hidden></span>
      `;
      this.host.appendChild(this.root);

      this.stage = this.root.querySelector(".script-morph__stage");
      this.svg = this.root.querySelector(".script-morph__svg");
      this.live = this.root.querySelector(".script-morph__live");
      this.phaseEl = this.root.querySelector(".script-morph__phase");
      this.btnPrev = this.root.querySelector(".script-morph__btn--prev");
      this.btnNext = this.root.querySelector(".script-morph__btn--next");
      this.btnFs = this.root.querySelector(".script-morph__btn--fullscreen");
      this.btnExit = this.root.querySelector(".script-morph__btn--exit");
    }

    _setPhase(term) {
      if (!this.phaseEl) return;
      if (!term) {
        this.phaseEl.hidden = true;
        this.phaseEl.textContent = "";
        return;
      }
      this.phaseEl.hidden = false;
      this.phaseEl.textContent = term;
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
      this.active = false;
      this.animating = false;
      this.host.classList.remove("is-active");
      this.label.focus();
    }

    _hideHint() {
      const hint = this.host.querySelector(".script-morph-hint");
      if (hint) hint.classList.add("is-hidden");
    }

    step(delta) {
      if (!this.active || this.animating) return;
      const next = (this.index + delta + this.carousel.length) % this.carousel.length;
      this.goTo(next);
    }

    goTo(nextIndex) {
      if (this.animating || nextIndex === this.index) return;
      const fromId = this.carousel[this.index];
      const toId = this.carousel[nextIndex];
      this.index = nextIndex;
      this._saveIndex();
      this._syncChooser();
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
        const pad = 40;
        const b = jm.bounds || [0, 0, jm.advance || 1, 800];
        this.svg.setAttribute(
          "viewBox",
          `0 ${b[1] - pad} ${Math.max(jm.advance || b[2] - b[0], 1) + pad * 2} ${Math.max(b[3] - b[1], 1) + pad * 2}`
        );
        const joined = document.createElementNS("http://www.w3.org/2000/svg", "path");
        joined.classList.add("script-morph__joined");
        joined.setAttribute("d", jm.path);
        g.appendChild(joined);
      } else {
        const order = reversed
          ? script.slots.map((_, i) => script.slots.length - 1 - i)
          : script.slots.map((_, i) => i);
        const metrics = slotBounds(script);
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
        this._renderScript(toId, true, { joined: to.family === "arabic" });
        return;
      }

      this.animating = true;
      const enteringCursive =
        to.compose && to.compose.mode === "cursive";
      const leavingCursive =
        from.compose && from.compose.mode === "cursive";
      try {
        // Lowercase English before leaving it.
        let morphFrom = from;
        if (from.id === "latin" && from.slots_lower) {
          this._setPhase("Case folding");
          await this._caseFold(from, /*toLower=*/ true);
          morphFrom = { ...from, slots: from.slots_lower };
        }

        // Arrive into lowercase English first, then restore case.
        let morphTo = to;
        const enteringLatin = to.id === "latin" && to.slots_lower;
        if (enteringLatin) {
          morphTo = { ...to, slots: to.slots_lower };
        }

        if (enteringCursive || leavingCursive) {
          await this._cursiveTransition(morphFrom, morphTo);
        } else {
          this._setPhase("Grapheme correspondence");
          const hops = resolvePath(this.data, fromId, toId);
          for (let i = 1; i < hops.length; i++) {
            const a = i === 1 ? morphFrom : scriptById(this.data, hops[i - 1]);
            const b =
              i === hops.length - 1 ? morphTo : scriptById(this.data, hops[i]);
            await this._morphSlots(a, b, false);
          }
        }

        // Data-driven post-morph composition (anusvāra attach, etc.).
        if (to.compose && to.compose.mode === "attach") {
          await this._composeAttach(to);
        }

        if (enteringLatin) {
          this._setPhase("Case folding");
          await this._caseFold(to, /*toLower=*/ false);
        }

        this._setPhase("");
        this.root.dataset.script = toId;
        this.root.dataset.dir = to.dir;
        this._announce(to);
      } finally {
        this.animating = false;
        this._setPhase("");
      }
    }

    /** Animate Latin proper ↔ lowercase slot-by-slot. */
    _caseFold(script, toLower) {
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
      });
    }

    /**
     * Morph slots one-by-one using crisp dual-path crossfades (no point-cloud artifacts).
     * LTR: left → right. Urdu/reversed: right → left.
     * opts.duration overrides per-slot timing; opts.sameScript softens dual coloring.
     */
    _morphSlots(from, to, reversed, opts = {}) {
      return new Promise((resolve) => {
        const n = from.slots.length;
        const fromGap = from.family === "arabic" ? 120 : 0;
        const slotMs = opts.duration || SLOT_MORPH_MS;
        const logicalAt = (visual) => (reversed ? n - 1 - visual : visual);

        const visualOrder = [];
        if (reversed) {
          for (let v = n - 1; v >= 0; v--) visualOrder.push(v);
        } else {
          for (let v = 0; v < n; v++) visualOrder.push(v);
        }

        // Build dual-path slot groups once (accurate outlines).
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.classList.add("script-morph__row");
        if (opts.sameScript) g.classList.add("script-morph__row--casefold");
        const groups = [];
        for (let visual = 0; visual < n; visual++) {
          const logical = logicalAt(visual);
          const a = from.slots[logical];
          const b = to.slots[logical];
          const advA = a.advance || 0;
          const advB = b.advance || 0;
          // Reserve the wider advance so from/to never spill into neighboring slots.
          const cellW = Math.max(advA, advB, 1);

          const slotG = document.createElementNS("http://www.w3.org/2000/svg", "g");
          slotG.classList.add("script-morph__slot-pair");
          slotG.dataset.slot = String(logical);
          slotG.dataset.visual = String(visual);

          const ba = a.bounds || [0, 0, advA, 800];
          const bb = b.bounds || [0, 0, advB, 800];
          const pad = 28;
          const by = Math.min(ba[1], bb[1]) - pad;
          const bh = Math.max(ba[3], bb[3]) - Math.min(ba[1], bb[1]) + pad * 2;

          const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          box.classList.add("script-morph__slot-box");
          box.setAttribute("x", String(-pad));
          box.setAttribute("y", String(by));
          box.setAttribute("width", String(cellW + pad * 2));
          box.setAttribute("height", String(Math.max(bh, 1)));
          box.setAttribute("rx", "20");

          const pathFrom = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathFrom.classList.add("script-morph__slot", "script-morph__slot--from");
          pathFrom.setAttribute("d", a.path || pointsToPath(a.points));
          // Center each glyph inside the shared cell so different sizes don't collide.
          pathFrom.setAttribute("transform", `translate(${(cellW - advA) / 2}, 0)`);
          pathFrom.style.opacity = "1";

          const pathTo = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathTo.classList.add("script-morph__slot", "script-morph__slot--to");
          pathTo.setAttribute("d", b.path || pointsToPath(b.points));
          pathTo.setAttribute("transform", `translate(${(cellW - advB) / 2}, 0)`);
          pathTo.style.opacity = "0";

          slotG.appendChild(box);
          slotG.appendChild(pathFrom);
          slotG.appendChild(pathTo);
          g.appendChild(slotG);
          groups.push({ slotG, pathFrom, pathTo, box, a, b, visual, logical, cellW });
        }
        this.svg.replaceChildren(g);
        this.svg.style.transform = "scale(1, -1)";

        // Layout cells by max(from,to) width — no overlap between neighbors.
        let x = 0;
        groups.forEach((item, visual) => {
          item.fixedX = x;
          item.slotG.setAttribute("transform", `translate(${x}, 0)`);
          x += item.cellW + (visual < n - 1 ? fromGap : 0);
        });
        const metrics = unionMetrics(from, to);
        metrics.width = Math.max(metrics.width, x, 1);
        setViewBox(this.svg, metrics);

        const progress = new Array(n).fill(0);
        let step = 0;
        let stepStarted = performance.now();

        const paint = () => {
          groups.forEach((item, visual) => {
            const t = progress[visual];
            item.slotG.setAttribute("transform", `translate(${item.fixedX}, 0)`);
            item.pathFrom.style.opacity = String(1 - t);
            item.pathTo.style.opacity = String(t);
            const active = visualOrder[step] === visual && t < 1;
            item.box.classList.toggle("is-active", active || (t > 0 && t < 1));
            item.box.style.opacity =
              t > 0 && t < 1 ? "1" : t === 0 && visualOrder[step] === visual ? "0.85" : "0.35";
          });
        };

        const settle = () => {
          this._setPhase("Metric settling");
          // Keep positions when a compose phase follows (cursive / mark attach).
          const skipReflow =
            (to.compose && (to.compose.mode === "cursive" || to.compose.mode === "attach"));
          const toGap = to.family === "arabic" ? 120 : 0;

          let tx = 0;
          groups.forEach((item, visual) => {
            item.startX = item.fixedX;
            item.startCellW = item.cellW;
            item.startPad = (item.cellW - (item.b.advance || 0)) / 2;
            if (skipReflow) {
              item.endX = item.fixedX;
              item.endCellW = item.cellW;
              item.endPad = item.startPad;
            } else {
              item.endX = tx;
              item.endCellW = item.b.advance || 0;
              item.endPad = 0;
              tx += item.endCellW + (visual < n - 1 ? toGap : 0);
            }
          });
          const endMetrics = skipReflow
            ? null
            : (() => {
                const m = slotBounds(to, { isolGap: toGap });
                m.width = Math.max(m.width, tx, 1);
                return m;
              })();
          const vb = (this.svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
          const startVB = { minY: vb[1], width: vb[2], height: vb[3] };

          groups.forEach((item) => {
            item.pathFrom.style.opacity = "0";
            item.pathTo.style.opacity = "1";
            item.pathTo.classList.add("script-morph__slot--settling");
            item.box.classList.remove("is-active");
          });

          const t0 = performance.now();
          const settleFrame = (now) => {
            const t = easeInOut(Math.min(1, (now - t0) / SETTLE_MS));
            groups.forEach((item) => {
              const x = item.startX + (item.endX - item.startX) * t;
              const cellW = item.startCellW + (item.endCellW - item.startCellW) * t;
              const padX = item.startPad + (item.endPad - item.startPad) * t;
              item.slotG.setAttribute("transform", `translate(${x}, 0)`);
              item.pathTo.setAttribute("transform", `translate(${padX}, 0)`);
              item.box.setAttribute("width", String(cellW + 56));
              item.box.style.opacity = String(0.35 * (1 - t));
            });
            if (endMetrics) {
              const width = startVB.width + (endMetrics.width - startVB.width) * t;
              const minY = startVB.minY + (endMetrics.minY - startVB.minY) * t;
              const height = startVB.height + (endMetrics.height - startVB.height) * t;
              setViewBox(this.svg, { minY, maxY: minY + height, width, height });
            }

            if (t < 1) {
              requestAnimationFrame(settleFrame);
              return;
            }

            groups.forEach((item) => {
              item.box.remove();
              item.pathFrom.remove();
              item.pathTo.classList.remove(
                "script-morph__slot--to",
                "script-morph__slot--from",
                "script-morph__slot--settling"
              );
              item.pathTo.classList.add("script-morph__slot");
              item.pathTo.removeAttribute("style");
              if (skipReflow) {
                item.pathTo.setAttribute(
                  "transform",
                  `translate(${item.endPad}, 0)`
                );
                item.slotG.setAttribute("transform", `translate(${item.endX}, 0)`);
              } else {
                item.pathTo.setAttribute("transform", "translate(0, 0)");
                item.slotG.setAttribute("transform", `translate(${item.endX}, 0)`);
              }
            });
            g.classList.remove("script-morph__row--casefold");
            if (endMetrics) setViewBox(this.svg, endMetrics);
            resolve();
          };
          requestAnimationFrame(settleFrame);
        };

        const frame = (now) => {
          if (step >= visualOrder.length) {
            paint();
            settle();
            return;
          }
          const visual = visualOrder[step];
          const local = Math.min(1, Math.max(0, (now - stepStarted) / slotMs));
          progress[visual] = easeInOut(local);
          paint();
          if (local < 1) {
            requestAnimationFrame(frame);
            return;
          }
          progress[visual] = 1;
          step += 1;
          if (step >= visualOrder.length) {
            paint();
            settle();
            return;
          }
          setTimeout(() => {
            stepStarted = performance.now();
            requestAnimationFrame(frame);
          }, SLOT_GAP_MS);
        };
        requestAnimationFrame(frame);
      });
    }

    /** Animate characters swapping into reversed string order (no glyph flip). */
    _reverseOrder(script, duration) {
      return new Promise((resolve) => {
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

        setViewBox(this.svg, slotBounds(script));
        const t0 = performance.now();

        const frame = (now) => {
          const t = easeInOut(Math.min(1, (now - t0) / duration));
          paths.forEach((el) => {
            const i = parseInt(el.dataset.slot, 10);
            const xNow = fromXs[i] + (toXs[i] - fromXs[i]) * t;
            el.setAttribute("transform", `translate(${xNow}, 0)`);
          });
          if (t < 1) requestAnimationFrame(frame);
          else {
            // Rebuild reversed without touching camera if locked
            this._renderScript(script.id, false, { joined: false, reversed: true });
            resolve();
          }
        };
        requestAnimationFrame(frame);
        void width;
      });
    }

    /** Un-reverse: RTL visual order back to LTR logical order. */
    _unreverseOrder(script, duration) {
      return new Promise((resolve) => {
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

        setViewBox(this.svg, slotBounds(script));
        const t0 = performance.now();

        const frame = (now) => {
          const t = easeInOut(Math.min(1, (now - t0) / duration));
          paths.forEach((el) => {
            const i = parseInt(el.dataset.slot, 10);
            const xNow = fromXs[i] + (ltrXs[i] - fromXs[i]) * t;
            el.setAttribute("transform", `translate(${xNow}, 0)`);
          });
          if (t < 1) requestAnimationFrame(frame);
          else {
            this._renderScript(script.id, false, { joined: false, reversed: false });
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    }

    /**
     * One-by-one RTL combining with fixed letter positions.
     * Each new joined form is centered on the midpoint of the two pieces
     * being combined — other letters stay put (gaps can remain).
     */
    _joinOneByOne(script) {
      return new Promise((resolve) => {
        const steps = script.join_steps || (script.joined ? [script.joined] : []);
        if (!steps.length) {
          resolve();
          return;
        }

        const n = script.slots.length;
        const isolGap = 120;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.classList.add("script-morph__row");

        // Fixed absolute layout for every isolated letter (visual L→R = logical n-1…0).
        const isol = [];
        let xCursor = 0;
        for (let logical = n - 1; logical >= 0; logical--) {
          const slot = script.slots[logical];
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.classList.add("script-morph__slot");
          path.dataset.slot = String(logical);
          path.setAttribute("d", slot.path || pointsToPath(slot.points));
          const x = xCursor;
          const adv = slot.advance || 0;
          path.setAttribute("transform", `translate(${x}, 0)`);
          g.appendChild(path);
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

        const joinedA = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const joinedB = document.createElementNS("http://www.w3.org/2000/svg", "path");
        joinedA.classList.add("script-morph__joined");
        joinedB.classList.add("script-morph__joined");
        joinedA.style.opacity = "0";
        joinedB.style.opacity = "0";
        g.appendChild(joinedA);
        g.appendChild(joinedB);
        this.svg.replaceChildren(g);
        this.svg.style.transform = "scale(1, -1)";

        // Freeze the wide isolated frame for the whole combine — no recentering.
        const lockedMetrics = slotBounds(script);
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
        let stepStarted = performance.now();
        const frame = (now) => {
          if (step >= n) {
            paint(n, 1);
            resolve();
            return;
          }
          const local = Math.min(1, Math.max(0, (now - stepStarted) / JOIN_STEP_MS));
          paint(step, easeInOut(local));
          if (local < 1) {
            requestAnimationFrame(frame);
            return;
          }
          paint(step, 1);
          step += 1;
          if (step >= n) {
            resolve();
            return;
          }
          setTimeout(() => {
            stepStarted = performance.now();
            requestAnimationFrame(frame);
          }, JOIN_GAP_MS);
        };
        requestAnimationFrame(frame);
      });
    }

    async _cursiveTransition(from, to) {
      const entering = to.compose && to.compose.mode === "cursive";
      if (entering) {
        this._setPhase("Reading-order reversal");
        await this._reverseOrder(from, REVERSE_MS);
        this._setPhase("Grapheme correspondence");
        await this._morphSlots(from, to, true);
        this._setPhase(to.compose.term || "Cursive joining");
        await this._joinOneByOne(to);
      } else {
        this._setPhase("Cursive segregation");
        this._renderScript(from.id, false, { joined: false, reversed: true });
        this._setPhase("Grapheme correspondence");
        await this._morphSlots(from, to, true);
        this._setPhase("Reading-order reversal");
        await this._unreverseOrder(to, REVERSE_MS);
      }
    }

    /**
     * Data-driven mark attachment (anusvāra, pulli, …): merge slot pairs in place.
     */
    async _composeAttach(script) {
      const steps = (script.compose && script.compose.steps) || [];
      for (const step of steps) {
        this._setPhase(step.term || script.compose.term || "Mark attachment");
        await this._attachMerge(script, step);
      }
    }

    _attachMerge(script, step) {
      return new Promise((resolve) => {
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

        const combined = document.createElementNS("http://www.w3.org/2000/svg", "path");
        combined.classList.add("script-morph__slot", "script-morph__composed");
        combined.setAttribute("d", step.path);
        combined.style.opacity = "0";
        // Sit on the base slot's origin (mark attaches to base).
        combined.setAttribute("transform", `translate(${baseX}, 0)`);
        row.appendChild(combined);

        const t0 = performance.now();
        const dur = JOIN_STEP_MS;
        const frame = (now) => {
          const t = easeInOut(Math.min(1, (now - t0) / dur));
          if (basePath) basePath.style.opacity = String(1 - t);
          if (markPath) markPath.style.opacity = String(1 - t);
          markG.style.opacity = String(1 - t);
          combined.style.opacity = String(t);
          // Optional: ease mark toward base while fading
          const x = markX + (baseX - markX) * t;
          markG.setAttribute("transform", `translate(${x}, 0)`);
          if (t < 1) {
            requestAnimationFrame(frame);
            return;
          }
          markG.remove();
          if (basePath) basePath.remove();
          combined.style.opacity = "1";
          // Keep composed glyph in the base group for stable slot indexing.
          baseG.appendChild(combined);
          combined.removeAttribute("style");
          combined.setAttribute("transform", "translate(0, 0)");
          baseG.setAttribute("transform", `translate(${baseX}, 0)`);
          resolve();
        };
        requestAnimationFrame(frame);
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
        <div class="script-morph-overlay__main"></div>
        <aside class="script-morph-chooser" aria-label="Choose script">
          <p class="script-morph-chooser__title">Scripts</p>
          <ul class="script-morph-chooser__list">${chooserItems}</ul>
        </aside>
      `;
      document.body.appendChild(this.overlay);
      document.body.classList.add("script-morph-open");

      const main = this.overlay.querySelector(".script-morph-overlay__main");
      this._fsHost = document.createElement("div");
      this._fsHost.className = "script-morph-host is-active";
      main.appendChild(this._fsHost);

      this._placeholder = document.createComment("script-morph-fs");
      this.root.parentNode.insertBefore(this._placeholder, this.root);
      this._fsHost.appendChild(this.root);
      this.root.classList.add("script-morph--fullscreen");
      this.btnFs.hidden = true;

      this.chooser = this.overlay.querySelector(".script-morph-chooser");
      this.chooser.addEventListener("click", (e) => {
        const btn = e.target.closest(".script-morph-chooser__btn");
        if (!btn) return;
        this.goToScriptId(btn.getAttribute("data-script"));
      });
      this._syncChooser();

      this.overlay.querySelector(".script-morph-overlay__close").addEventListener("click", () => {
        this.closeFullscreen();
      });
      this.overlay.querySelector(".script-morph-overlay__close").focus();
    }

    closeFullscreen() {
      if (!this.fullscreen) return;
      this.fullscreen = false;
      this.btnFs.hidden = false;
      this.root.classList.remove("script-morph--fullscreen");
      this.chooser = null;
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
