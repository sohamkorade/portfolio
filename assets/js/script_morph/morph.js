import {
  el,
  slotPath,
  slotsEqual,
  ISOL_GAP,
  BOX_PAD,
  lerp,
  resolveAttachedSlots,
} from "./util.js";
import {
  displayMetrics,
  setViewBox,
  morphToFit,
  slotOrigins,
  rtlXs,
} from "./metrics.js";

function atomList(slot) {
  return slot.atoms?.length > 1 ? slot.atoms : null;
}

function paintAtomPair(slotG, fromAtoms, toAtoms, t, fromPad, toPad, scale, dy) {
  const n = Math.max(fromAtoms.length, toAtoms.length);
  let xFrom = fromPad;
  let xTo = toPad;
  for (let i = 0; i < n; i++) {
    const a = fromAtoms[i] || fromAtoms[fromAtoms.length - 1];
    const b = toAtoms[i] || toAtoms[toAtoms.length - 1];
    const local = Math.max(0, Math.min(1, t * n - i));
    if (a && !a.empty) {
      const p = el("path", {
        className: "script-morph__slot script-morph__slot--from",
        d: slotPath(a),
        transform: `translate(${xFrom}, 0)`,
      });
      p.style.opacity = String(1 - local);
      slotG.appendChild(p);
      xFrom += a.advance || 0;
    }
    if (b && !b.empty) {
      const p = el("path", {
        className: "script-morph__slot script-morph__slot--to",
        d: slotPath(b),
        transform: `translate(${xTo}, ${dy}) scale(${scale})`,
      });
      p.style.opacity = String(local);
      slotG.appendChild(p);
      xTo += (b.advance || 0) * scale;
    }
  }
}

/** Dual-path (or atom) crossfade for one morph snapshot. */
export function paintMorph(svg, state) {
  const { morphFrom: from, morphTo: to, progress, prepT, sameScript, reversed } = state;
  const n = from.slots.length;
  const fromGap = from.family === "arabic" ? ISOL_GAP : 0;
  const fit = sameScript
    ? { scale: 1, dy: 0, fromM: displayMetrics(from) }
    : morphToFit(from, to);
  const { scale: toScale, dy: toDy } = fit;

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
    const advA = a.advance || 0;
    const advB = (b.advance || 0) * toScale;
    const startCellW = Math.max(advA, 1);
    const endCellW = Math.max(advA, advB, 1);
    const cellW = lerp(startCellW, endCellW, prepT);
    const fromPadX = ((endCellW - advA) / 2) * prepT;
    const toPadX = (cellW - advB) / 2;

    const ba = a.bounds || [0, 0, advA, 800];
    const bbRaw = b.bounds || [0, 0, b.advance || 0, 800];
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
    box.style.opacity = changed
      ? String(0.35 * prepT + (t > 0 && t < 1 ? 0.65 : 0))
      : "0";
    if (t > 0 && t < 1) box.classList.add("is-active");

    const slotG = el("g", {
      className: changed
        ? "script-morph__slot-pair"
        : "script-morph__slot-pair is-unchanged",
      "data-slot": logical,
      "data-visual": visual,
    });
    slotG.appendChild(box);

    const fromAtoms = atomList(a);
    const toAtoms = atomList(b);
    if (fromAtoms && toAtoms && changed) {
      paintAtomPair(slotG, fromAtoms, toAtoms, t, fromPadX, toPadX, toScale, toDy);
    } else {
      const pathFrom = el("path", {
        className: "script-morph__slot script-morph__slot--from",
        d: slotPath(a),
        transform: `translate(${fromPadX}, 0)`,
      });
      pathFrom.style.opacity = changed ? String(1 - t) : "0";
      const pathTo = el("path", {
        className: "script-morph__slot script-morph__slot--to",
        d: slotPath(b),
        transform: `translate(${toPadX}, ${toDy}) scale(${toScale})`,
      });
      pathTo.style.opacity = changed ? String(t) : "1";
      slotG.appendChild(pathFrom);
      slotG.appendChild(pathTo);
    }

    g.appendChild(slotG);
    items.push({ slotG, startCellW, endCellW });
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
