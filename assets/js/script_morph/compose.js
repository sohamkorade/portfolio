import { el, slotPath, ISOL_GAP, lerp } from "./util.js";
import { displayMetrics, setViewBox, rtlXs } from "./metrics.js";
import { paintStatic } from "./morph.js";

export function paintSpread(svg, script, t) {
  const n = script.slots.length;
  const { xs: startXs } = rtlXs(script, 0);
  const { xs: endXs, width } = rtlXs(script, ISOL_GAP);
  const startM = displayMetrics(script);
  const endM = displayMetrics(script, { isolGap: ISOL_GAP });
  endM.width = Math.max(endM.width, width, 1);

  const g = el("g", {
    className: "script-morph__row script-morph__row--joining",
  });
  for (let logical = 0; logical < n; logical++) {
    g.appendChild(
      el("path", {
        className: "script-morph__slot script-morph__slot--unjoined",
        d: slotPath(script.slots[logical]),
        transform: `translate(${lerp(startXs[logical], endXs[logical], t)}, 0)`,
        "data-slot": logical,
      })
    );
  }
  setViewBox(svg, {
    minY: lerp(startM.minY, endM.minY, t),
    maxY: lerp(startM.maxY, endM.maxY, t),
    height: lerp(startM.height, endM.height, t),
    width: lerp(startM.width, endM.width, t),
    tight: endM.tight,
  });
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}

export function paintJoin(svg, script, absorbed, t) {
  const n = script.slots.length;
  const steps = script.join_steps || (script.joined ? [script.joined] : []);
  const { xs, width } = rtlXs(script, ISOL_GAP);
  const g = el("g", {
    className: "script-morph__row script-morph__row--joining",
  });

  const isol = [];
  for (let logical = 0; logical < n; logical++) {
    const slot = script.slots[logical];
    const adv = slot.advance || 0;
    const path = el("path", {
      className: "script-morph__slot script-morph__slot--unjoined",
      d: slotPath(slot),
      transform: `translate(${xs[logical]}, 0)`,
      "data-slot": logical,
    });
    isol.push({ path, logical, x: xs[logical], advance: adv });
    g.appendChild(path);
  }

  const first = isol.find((i) => i.logical === 0);
  const clusterRight = first ? first.x + first.advance : width;
  const joinedA = el("path", { className: "script-morph__joined" });
  const joinedB = el("path", { className: "script-morph__joined" });
  joinedA.style.opacity = "0";
  joinedB.style.opacity = "0";
  g.appendChild(joinedA);
  g.appendChild(joinedB);

  const place = (elPath, step, opacity) => {
    if (!step?.path) {
      elPath.style.opacity = "0";
      return;
    }
    const adv = step.advance || 0;
    elPath.setAttribute("d", step.path);
    elPath.setAttribute("transform", `translate(${clusterRight - adv}, 0)`);
    elPath.style.opacity = String(opacity);
  };

  isol.forEach((item) => {
    if (item.logical > absorbed) item.path.style.opacity = "1";
    else if (item.logical < absorbed) item.path.style.opacity = "0";
  });

  const absorbing = isol.find((i) => i.logical === absorbed);
  const prev = absorbed > 0 ? steps[absorbed - 1] : null;
  const next = absorbed < steps.length ? steps[absorbed] : null;

  if (absorbed >= n) {
    place(joinedA, steps[steps.length - 1] || script.joined, 1);
  } else if (absorbing && next) {
    absorbing.path.style.opacity = String(1 - t);
    if (!prev) place(joinedA, next, t);
    else {
      place(joinedA, prev, 1 - t);
      place(joinedB, next, t);
    }
  } else if (prev) {
    place(joinedA, prev, 1);
  }

  const metrics = displayMetrics(script, { isolGap: ISOL_GAP });
  metrics.width = Math.max(metrics.width, width, 1);
  setViewBox(svg, metrics);
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}

export function paintAttach(svg, script, stepIdx, t) {
  const steps = script.compose?.steps || [];
  if (t >= 0.999 && stepIdx >= steps.length - 1) {
    paintStatic(svg, script, { attached: true });
    return;
  }

  const done = new Set();
  for (let i = 0; i < stepIdx; i++) {
    (steps[i].slots || []).slice(1).forEach((s) => done.add(s));
  }
  const cur = steps[stepIdx];
  const mergeSlots = cur?.slots || [];
  const baseI = mergeSlots[0];
  const markI = mergeSlots[1];

  const g = el("g", { className: "script-morph__row" });
  const n = script.slots.length;
  let x = 0;
  const positions = [];

  for (let i = 0; i < n; i++) {
    if (done.has(i)) {
      positions.push(x);
      continue;
    }
    let pathD = slotPath(script.slots[i]);
    let adv = script.slots[i].advance || 0;
    for (let s = 0; s < stepIdx; s++) {
      const st = steps[s];
      if (st.slots?.[0] === i && st.path) {
        pathD = st.path;
        adv = st.advance || adv;
      }
    }
    positions.push(x);

    if (i === markI && cur) {
      const mark = el("path", {
        className: "script-morph__slot",
        d: slotPath(script.slots[markI]),
        transform: `translate(${lerp(x, positions[baseI] ?? 0, t)}, 0)`,
        "data-slot": markI,
      });
      mark.style.opacity = String(1 - t);
      g.appendChild(mark);
      const composed = el("path", {
        className: "script-morph__slot script-morph__composed",
        d: cur.path,
        transform: `translate(${positions[baseI] ?? 0}, 0)`,
      });
      composed.style.opacity = String(t);
      g.appendChild(composed);
      continue;
    }

    if (i === baseI && cur) {
      const base = el("path", {
        className: "script-morph__slot",
        d: pathD,
        transform: `translate(${x}, 0)`,
        "data-slot": i,
      });
      base.style.opacity = String(1 - t);
      g.appendChild(base);
      x += cur.advance || adv;
      continue;
    }

    g.appendChild(
      el("path", {
        className: "script-morph__slot",
        d: pathD,
        transform: `translate(${x}, 0)`,
        "data-slot": i,
      })
    );
    x += adv;
  }

  setViewBox(svg, { ...displayMetrics(script), width: Math.max(x, 1) });
  svg.replaceChildren(g);
  svg.style.transform = "scale(1, -1)";
}

export function paintSettle(svg, script, t, joined) {
  if (joined && script.joined) {
    if (t >= 0.999) {
      paintStatic(svg, script, { joined: true });
      return;
    }
    paintJoin(svg, script, script.slots.length, 1);
    const metrics = displayMetrics({
      ...script,
      slots: [
        {
          empty: false,
          advance: script.joined.advance || 0,
          bounds: script.joined.bounds || [0, 0, 1, 800],
        },
      ],
    });
    metrics.width = Math.max(script.joined.advance || metrics.width, 1);
    const vb = (svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    setViewBox(svg, {
      minY: lerp(vb[1], metrics.minY, t),
      maxY: lerp(vb[1] + vb[3], metrics.maxY, t),
      height: lerp(vb[3], metrics.height, t),
      width: lerp(vb[2], metrics.width, t),
      tight: metrics.tight,
    });
    return;
  }
  // Keep attach merges through metric settle / final frame.
  paintStatic(svg, script, { attached: true });
}
