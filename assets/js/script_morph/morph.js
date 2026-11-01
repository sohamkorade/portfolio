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
  atomOpacity = 1
) {
  const { from, to, n } = padAtoms(fromAtoms, toAtoms);
  let xFrom = fromPad;
  let xTo = toPad;
  for (let i = 0; i < n; i++) {
    const a = from[i];
    const b = to[i];
    const local = atomTs?.[i] ?? 0;
    if (a && !a.empty) {
      const p = el("path", {
        className: "script-morph__slot script-morph__slot--from",
        d: slotPath(a),
        transform: `translate(${xFrom}, 0)`,
      });
      p.style.opacity = String((1 - local) * atomOpacity);
      slotG.appendChild(p);
      xFrom += a.advance || 0;
    }
    if (b && !b.empty) {
      const p = el("path", {
        className: "script-morph__slot script-morph__slot--to",
        d: slotPath(b),
        transform: `translate(${xTo}, ${dy}) scale(${scale})`,
      });
      p.style.opacity = String(local * atomOpacity);
      slotG.appendChild(p);
      xTo += (b.advance || 0) * scale;
    }
  }
}

function attachLookup(to, attachProgress) {
  const byBase = new Map();
  const byMark = new Map();
  if (to.compose?.mode !== "attach") return { byBase, byMark };
  for (const st of to.compose.steps || []) {
    const [base, mark] = st.slots || [];
    if (base == null || mark == null || !st.path) continue;
    const t = attachProgress?.[base] ?? 0;
    byBase.set(base, { mark, compose: st, t });
    byMark.set(mark, { base, compose: st, t });
  }
  return { byBase, byMark };
}

/** Dual-path matra-level crossfade for one morph snapshot. */
export function paintMorph(svg, state) {
  const {
    morphFrom: from,
    morphTo: to,
    progress,
    atomProgress,
    combineProgress,
    attachProgress,
    prepT,
    sameScript,
    reversed,
  } = state;
  const n = from.slots.length;
  const fromGap = from.family === "arabic" ? ISOL_GAP : 0;
  const fit = sameScript
    ? { scale: 1, dy: 0, fromM: displayMetrics(from) }
    : morphToFit(from, to);
  const { scale: toScale, dy: toDy } = fit;
  const { byBase, byMark } = attachLookup(to, attachProgress);

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
    const absorbedMark = markInfo && attachT >= 0.999;

    if (absorbedMark) {
      items.push({
        slotG: null,
        startCellW: Math.max(a.advance || 0, 1),
        endCellW: 0,
        skip: true,
      });
      continue;
    }

    let displayB = b;
    let advB = (b.advance || 0) * toScale;
    if (baseInfo && attachT >= 0.999) {
      displayB = {
        ...b,
        path: baseInfo.compose.path,
        points: baseInfo.compose.points,
        advance: baseInfo.compose.advance,
        bounds: baseInfo.compose.bounds,
        empty: baseInfo.compose.empty,
      };
      advB = (baseInfo.compose.advance || 0) * toScale;
    } else if (baseInfo && attachT > 0) {
      advB = lerp(
        (b.advance || 0) * toScale,
        (baseInfo.compose.advance || 0) * toScale,
        attachT
      );
    }

    const advA = a.advance || 0;
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
    const needsCombine = changed && atomN > 1;
    const combine = needsCombine ? combineProgress?.[logical] ?? 0 : 1;

    const ba = a.bounds || [0, 0, advA, 800];
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
    box.style.opacity = changed || activeAttach
      ? String(0.35 * prepT + (t > 0 && t < 1 || activeAttach ? 0.65 : 0))
      : "0";
    if ((t > 0 && t < 1) || activeAttach) box.classList.add("is-active");

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

    if (baseInfo && attachT > 0.001) {
      // Anusvāra/pulli combine: fade base (+ its matured atoms) into composed outline.
      const baseOpacity = 1 - attachT;
      if (needsCombine && combine < 0.999) {
        paintAtomPair(
          slotG,
          fromAtoms,
          toAtoms,
          atomTs,
          fromPadX,
          toPadX,
          toScale,
          toDy,
          baseOpacity * (1 - combine)
        );
        if (combine > 0.001) {
          const syl = el("path", {
            className: "script-morph__slot script-morph__slot--to",
            d: slotPath(b),
            transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
          });
          syl.style.opacity = String(combine * baseOpacity);
          slotG.appendChild(syl);
        }
      } else {
        const basePath = el("path", {
          className: "script-morph__slot script-morph__slot--to",
          d: slotPath(b),
          transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
        });
        basePath.style.opacity = String(baseOpacity);
        slotG.appendChild(basePath);
      }
      const composed = el("path", {
        className: "script-morph__slot script-morph__slot--to script-morph__composed",
        d: baseInfo.compose.path,
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      composed.style.opacity = String(attachT);
      slotG.appendChild(composed);
    } else if (markInfo && attachT > 0.001) {
      // Mark slides away / fades while base absorbs it.
      const markPath = el("path", {
        className: "script-morph__slot script-morph__slot--to",
        d: slotPath(b),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      markPath.style.opacity = String(1 - attachT);
      slotG.appendChild(markPath);
    } else if (!changed || (needsCombine && combine >= 0.999)) {
      const pathTo = el("path", {
        className: changed
          ? "script-morph__slot script-morph__slot--to"
          : "script-morph__slot",
        d: slotPath(displayB),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      pathTo.style.opacity = "1";
      slotG.appendChild(pathTo);
    } else if (needsCombine && combine > 0.001) {
      paintAtomPair(
        slotG,
        fromAtoms,
        toAtoms,
        atomTs,
        fromPadX,
        toPadX,
        toScale,
        toDy,
        1 - combine
      );
      const combined = el("path", {
        className: "script-morph__slot script-morph__slot--to script-morph__composed",
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
        1
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
