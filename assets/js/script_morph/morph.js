import {
  el,
  slotPath,
  slotsEqual,
  ISOL_GAP,
  BOX_PAD,
  lerp,
  resolveAttachedSlots,
  atomsOf,
  padAtoms,
} from "./util.js";
import {
  displayMetrics,
  setViewBox,
  morphToFit,
  slotOrigins,
  rtlXs,
} from "./metrics.js";

const CLS_FROM = "script-morph__slot script-morph__slot--from";
const CLS_TO = "script-morph__slot script-morph__slot--to";

/** Base consonant vs matra/anusvāra while unjoined; else script from→to. */
function atomClass(i, side, split) {
  if (split) return i === 0 ? CLS_FROM : CLS_TO;
  return side === "from" ? CLS_FROM : CLS_TO;
}

/** Per-atom x origins; RTL places logical index 0 on the right. */
function atomOrigins(atoms, pad, scale = 1, rtl = false) {
  const adv = atoms.map((a) =>
    a && !a.empty ? (a.advance || 0) * scale : 0
  );
  const xs = new Array(atoms.length);
  if (!rtl) {
    let x = pad;
    for (let i = 0; i < atoms.length; i++) {
      xs[i] = x;
      x += adv[i];
    }
  } else {
    let x = pad;
    for (let i = atoms.length - 1; i >= 0; i--) {
      xs[i] = x;
      x += adv[i];
    }
  }
  return xs;
}

/** Crossfade padded base/matra atoms using per-atom progress. */
function paintAtomPair(
  slotG,
  fromAtoms,
  toAtoms,
  atomTs,
  fromPad,
  toPad,
  scale,
  dy,
  atomOpacity = 1,
  { fromRtl = false, toRtl = false } = {}
) {
  const { from, to, n } = padAtoms(fromAtoms, toAtoms);
  const split = fromAtoms.length > 1 || toAtoms.length > 1;
  const fromXs = atomOrigins(from, fromPad, 1, fromRtl);
  const toXs = atomOrigins(to, toPad, scale, toRtl);
  for (let i = 0; i < n; i++) {
    const a = from[i];
    const b = to[i];
    const local = atomTs?.[i] ?? 0;
    if (a && !a.empty) {
      const p = el("path", {
        className: atomClass(i, "from", split),
        d: slotPath(a),
        transform: `translate(${fromXs[i]}, 0)`,
      });
      p.style.opacity = String((1 - local) * atomOpacity);
      slotG.appendChild(p);
    }
    if (b && !b.empty) {
      const p = el("path", {
        className: atomClass(i, "to", split),
        d: slotPath(b),
        transform: `translate(${toXs[i]}, ${dy}) scale(${scale})`,
      });
      p.style.opacity = String(local * atomOpacity);
      slotG.appendChild(p);
    }
  }
}

function attachLookup(script, progressByBase, fallbackT = 0) {
  const byBase = new Map();
  const byMark = new Map();
  if (script?.compose?.mode !== "attach") return { byBase, byMark };
  for (const st of script.compose.steps || []) {
    const [base, mark] = st.slots || [];
    if (base == null || mark == null || !st.path) continue;
    const t = progressByBase?.[base] ?? fallbackT;
    byBase.set(base, { mark, compose: st, t });
    byMark.set(mark, { base, compose: st, t });
  }
  return { byBase, byMark };
}

function composedSlot(slot, compose) {
  return {
    ...slot,
    text: compose.text || slot.text,
    path: compose.path,
    points: compose.points,
    advance: compose.advance,
    bounds: compose.bounds,
    empty: !!compose.empty,
    atoms: undefined,
  };
}

/** Dual-path matra-level crossfade for one morph snapshot. */
export function paintMorph(svg, state) {
  const {
    morphFrom: from,
    morphTo: to,
    progress,
    atomProgress,
    discombineProgress,
    combineProgress,
    detachProgress,
    attachProgress,
    prepT,
    sameScript,
    reversed,
  } = state;
  const n = from.slots.length;
  const fromGap = from.family === "arabic" ? ISOL_GAP : 0;
  const fromRtl = from.dir === "rtl";
  const toRtl = to.dir === "rtl";
  const atomRtl = { fromRtl, toRtl };
  const fromSettled = resolveAttachedSlots(from);
  const toSettled = resolveAttachedSlots(to);
  const fit = sameScript
    ? { scale: 1, dy: 0, fromM: displayMetrics(from) }
    : morphToFit(from, to);
  const { scale: toScale, dy: toDy } = fit;
  // Leave-A detach: t=0 composed, t=1 separated. Arrive-B attach: t=0 sep, t=1 composed.
  const fromAttach = attachLookup(from, detachProgress, 1);
  const toAttach = attachLookup(to, attachProgress, 0);
  const { byBase, byMark } = toAttach;

  const g = el("g", {
    className: sameScript
      ? "script-morph__row script-morph__row--casefold"
      : "script-morph__row",
  });

  const logicalAt = (visual) => (reversed ? n - 1 - visual : visual);
  const items = [];

  for (let visual = 0; visual < n; visual++) {
    const logical = logicalAt(visual);
    const a = from.slots[logical];
    const b = to.slots[logical];
    const t = progress[logical];
    const changed = !slotsEqual(a, b);
    const markInfo = byMark.get(logical);
    const baseInfo = byBase.get(logical);
    const attachT = markInfo?.t ?? baseInfo?.t ?? 0;
    const fromMark = fromAttach.byMark.get(logical);
    const fromBase = fromAttach.byBase.get(logical);
    const detachT = fromMark?.t ?? fromBase?.t ?? 1;
    // Mark absorbed into from's settled compose until detach finishes.
    const absorbedFromMark = fromMark && detachT < 0.001;
    const absorbedMark = markInfo && attachT >= 0.999;
    // Unchanged attach groups stay settled for the whole morph.
    const settledMark =
      !changed &&
      ((fromMark && from.compose?.mode === "attach") ||
        (markInfo && to.compose?.mode === "attach"));

    if (absorbedMark || absorbedFromMark || settledMark) {
      items.push({
        slotG: null,
        startCellW: absorbedFromMark || settledMark ? 0 : Math.max(a.advance || 0, 1),
        endCellW: absorbedMark || settledMark ? 0 : Math.max((b.advance || 0) * toScale, 1),
        skip: true,
      });
      continue;
    }

    let displayA = a;
    let advA = a.advance || 0;
    if (fromBase && detachT < 0.999) {
      if (detachT <= 0.001) {
        displayA = composedSlot(a, fromBase.compose);
        advA = fromBase.compose.advance || 0;
      } else {
        advA = lerp(fromBase.compose.advance || 0, a.advance || 0, detachT);
      }
    } else if (!changed && fromSettled[logical] && from.compose?.mode === "attach") {
      displayA = fromSettled[logical];
      advA = displayA.advance || 0;
    }

    let displayB = b;
    let advB = (b.advance || 0) * toScale;
    if (baseInfo && attachT >= 0.999) {
      displayB = composedSlot(b, baseInfo.compose);
      advB = (baseInfo.compose.advance || 0) * toScale;
    } else if (baseInfo && attachT > 0) {
      advB = lerp(
        (b.advance || 0) * toScale,
        (baseInfo.compose.advance || 0) * toScale,
        attachT
      );
    } else if (!changed && toSettled[logical] && to.compose?.mode === "attach") {
      displayB = toSettled[logical];
      advB = (displayB.advance || 0) * toScale;
    }

    const startCellW = Math.max(advA, 1);
    let endCellW = Math.max(advA, advB, 1);
    if (markInfo && attachT > 0) {
      endCellW = lerp(Math.max(advA, (b.advance || 0) * toScale, 1), 0, attachT);
      advB = endCellW;
    }
    const cellW = lerp(startCellW, Math.max(endCellW, 0.01), prepT);
    const fromPadX = ((Math.max(endCellW, 1) - advA) / 2) * prepT;
    const toPadX = (cellW - Math.max(advB, 0.01)) / 2;
    const fromAtoms = atomsOf(a);
    const toAtoms = atomsOf(b);
    const { n: atomN } = padAtoms(fromAtoms, toAtoms);
    const needsDiscombine = changed && fromAtoms.length > 1;
    const needsCombine = changed && toAtoms.length > 1;
    const discombine = needsDiscombine
      ? discombineProgress?.[logical] ?? 0
      : 1;
    const combine = needsCombine ? combineProgress?.[logical] ?? 0 : 1;

    const ba = displayA.bounds || a.bounds || [0, 0, advA, 800];
    const bbRaw = displayB.bounds || b.bounds || [0, 0, b.advance || 0, 800];
    const by =
      Math.min(ba[1], bbRaw[1] * toScale + toDy) - BOX_PAD;
    const bh =
      Math.max(ba[3], bbRaw[3] * toScale + toDy) -
      Math.min(ba[1], bbRaw[1] * toScale + toDy) +
      BOX_PAD * 2;

    const box = el("rect", {
      className: "script-morph__slot-box",
      x: -BOX_PAD,
      y: by,
      width: cellW + BOX_PAD * 2,
      height: Math.max(bh, 1),
      rx: 20,
    });
    const activeAttach = attachT > 0 && attachT < 1;
    const activeDetach = detachT > 0 && detachT < 1;
    box.style.opacity = changed || activeAttach || activeDetach
      ? String(
          0.35 * prepT +
            (t > 0 && t < 1 || activeAttach || activeDetach ? 0.65 : 0)
        )
      : "0";
    if ((t > 0 && t < 1) || activeAttach || activeDetach) {
      box.classList.add("is-active");
    }

    const slotG = el("g", {
      className: changed
        ? "script-morph__slot-pair"
        : "script-morph__slot-pair is-unchanged",
      "data-slot": logical,
      "data-visual": visual,
    });
    slotG.appendChild(box);

    const atomTs =
      atomProgress?.[logical] ||
      (changed ? [t] : [1]);

    // Leave-A detach: composed → consonant (--from) + anusvāra (--to).
    if (fromBase && detachT < 0.999 && changed) {
      const composed = el("path", {
        className: `${CLS_FROM} script-morph__composed`,
        d: fromBase.compose.path,
        transform: `translate(${fromPadX}, 0)`,
      });
      composed.style.opacity = String(1 - detachT);
      slotG.appendChild(composed);
      if (detachT > 0.001) {
        const basePath = el("path", {
          className: CLS_FROM,
          d: slotPath(a),
          transform: `translate(${fromPadX}, 0)`,
        });
        basePath.style.opacity = String(detachT * (1 - (atomTs[0] || 0)));
        slotG.appendChild(basePath);
      }
      // Once detached, fall through only when detach done — otherwise skip atom path.
      if (detachT < 0.999) {
        g.appendChild(slotG);
        items.push({ slotG, startCellW, endCellW, skip: false });
        continue;
      }
    }
    if (fromMark && detachT < 0.999 && changed) {
      const markPath = el("path", {
        className: CLS_TO,
        d: slotPath(a),
        transform: `translate(${fromPadX}, 0)`,
      });
      markPath.style.opacity = String(detachT);
      slotG.appendChild(markPath);
      g.appendChild(slotG);
      items.push({
        slotG,
        startCellW: Math.max((a.advance || 0) * detachT, 0.01),
        endCellW,
        skip: false,
      });
      continue;
    }

    if (baseInfo && attachT > 0.001) {
      // Arrive-B attach: consonant (--from) + mark (--to) → composed.
      const baseOpacity = 1 - attachT;
      if ((needsDiscombine || needsCombine) && (discombine < 0.999 || combine < 0.999)) {
        if (discombine < 0.999) {
          const sylA = el("path", {
            className: CLS_FROM,
            d: slotPath(a),
            transform: `translate(${fromPadX}, 0)`,
          });
          sylA.style.opacity = String((1 - discombine) * baseOpacity);
          slotG.appendChild(sylA);
        }
        paintAtomPair(
          slotG,
          fromAtoms,
          toAtoms,
          atomTs,
          fromPadX,
          toPadX,
          toScale,
          toDy,
          baseOpacity * discombine * (1 - combine),
          atomRtl
        );
        if (combine > 0.001) {
          const syl = el("path", {
            className: CLS_TO,
            d: slotPath(b),
            transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
          });
          syl.style.opacity = String(combine * baseOpacity);
          slotG.appendChild(syl);
        }
      } else {
        const basePath = el("path", {
          className: CLS_FROM,
          d: slotPath(b),
          transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
        });
        basePath.style.opacity = String(baseOpacity);
        slotG.appendChild(basePath);
      }
      const composed = el("path", {
        className: `${CLS_TO} script-morph__composed`,
        d: baseInfo.compose.path,
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      composed.style.opacity = String(attachT);
      slotG.appendChild(composed);
    } else if (markInfo && attachT > 0.001) {
      // Anusvāra (--to) fades while base absorbs it.
      const markPath = el("path", {
        className: CLS_TO,
        d: slotPath(b),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      markPath.style.opacity = String(1 - attachT);
      slotG.appendChild(markPath);
    } else if (!changed || (needsCombine && combine >= 0.999)) {
      const pathTo = el("path", {
        className: changed ? CLS_TO : "script-morph__slot",
        d: slotPath(displayB),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      pathTo.style.opacity = "1";
      slotG.appendChild(pathTo);
    } else if (needsDiscombine && discombine < 0.999) {
      // Leave A: combined → consonant (--from) + matra (--to).
      const sylA = el("path", {
        className: CLS_FROM,
        d: slotPath(a),
        transform: `translate(${fromPadX}, 0)`,
      });
      sylA.style.opacity = String(1 - discombine);
      slotG.appendChild(sylA);
      paintAtomPair(
        slotG,
        fromAtoms,
        toAtoms,
        atomTs,
        fromPadX,
        toPadX,
        toScale,
        toDy,
        discombine,
        atomRtl
      );
    } else if (needsCombine && combine > 0.001) {
      // Settle B: consonant (--from) + matra (--to) → combined.
      paintAtomPair(
        slotG,
        fromAtoms,
        toAtoms,
        atomTs,
        fromPadX,
        toPadX,
        toScale,
        toDy,
        1 - combine,
        atomRtl
      );
      const combined = el("path", {
        className: `${CLS_TO} script-morph__composed`,
        d: slotPath(b),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      combined.style.opacity = String(combine);
      slotG.appendChild(combined);
    } else {
      paintAtomPair(
        slotG,
        fromAtoms,
        toAtoms,
        atomTs,
        fromPadX,
        toPadX,
        toScale,
        toDy,
        1,
        atomRtl
      );
    }

    g.appendChild(slotG);
    items.push({ slotG, startCellW, endCellW, skip: false });
  }

  let startX = 0;
  let endX = 0;
  items.forEach((item, visual) => {
    item.startX = startX;
    item.endX = endX;
    startX += item.startCellW + (visual < n - 1 ? fromGap : 0);
    endX += item.endCellW + (visual < n - 1 ? fromGap : 0);
  });
  items.forEach((item) => {
    if (item.skip || !item.slotG) return;
    item.slotG.setAttribute(
      "transform",
      `translate(${lerp(item.startX, item.endX, prepT)}, 0)`
    );
  });

  setViewBox(svg, {
    minY: fit.fromM.minY,
    maxY: fit.fromM.maxY,
    height: fit.fromM.height,
    width: lerp(
      Math.max(fit.fromM.width, startX, 1),
      Math.max(fit.fromM.width, endX, 1),
      prepT
    ),
    tight: !!fit.fromM.tight,
  });
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}

export function paintStatic(svg, script, opts = {}) {
  const g = el("g", { className: "script-morph__row" });
  if (opts.joined && script.joined?.path) {
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
    setViewBox(svg, metrics);
    g.appendChild(el("path", { className: "script-morph__joined", d: jm.path }));
  } else {
    // Resting / settle frames keep attach merges (anusvāra, pulli, …).
    const applyAttach = opts.attached !== false && script.compose?.mode === "attach";
    const slots = applyAttach ? resolveAttachedSlots(script) : script.slots;
    const viewScript = slots === script.slots ? script : { ...script, slots };
    const reversed = !!opts.reversed;
    const isolGap = opts.isolGap || 0;
    const n = slots.length;
    const order = reversed
      ? [...Array(n).keys()].map((i) => n - 1 - i)
      : [...Array(n).keys()];
    let x = 0;
    order.forEach((logical, visual) => {
      const slot = slots[logical];
      if (slot.empty && !(slot.advance > 0)) {
        // Absorbed mark slot — skip entirely (no advance).
        return;
      }
      g.appendChild(
        el("path", {
          className: opts.joining
            ? "script-morph__slot script-morph__slot--unjoined"
            : "script-morph__slot",
          d: slotPath(slot),
          transform: `translate(${x}, 0)`,
          "data-slot": logical,
          "data-visual": visual,
        })
      );
      x += (slot.advance || 0) + isolGap;
    });
    const metrics = displayMetrics(viewScript, { isolGap });
    metrics.width = Math.max(metrics.width, x, 1);
    setViewBox(svg, metrics);
    if (opts.joining) g.classList.add("script-morph__row--joining");
  }
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}

export function paintReverse(svg, script, t, unreverse = false) {
  const n = script.slots.length;
  const { xs: ltr } = slotOrigins(script);
  const { xs: rtl } = rtlXs(script);
  const fromXs = unreverse ? rtl : ltr;
  const toXs = unreverse ? ltr : rtl;
  const g = el("g", { className: "script-morph__row" });
  for (let i = 0; i < n; i++) {
    g.appendChild(
      el("path", {
        className: "script-morph__slot",
        d: slotPath(script.slots[i]),
        transform: `translate(${lerp(fromXs[i], toXs[i], t)}, 0)`,
        "data-slot": i,
      })
    );
  }
  setViewBox(svg, displayMetrics(script));
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}
