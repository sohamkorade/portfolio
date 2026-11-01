import { ISOL_GAP } from "./util.js";

const ARABIC_DISPLAY_EM = 960;

export function slotOrigins(script, isolGap = 0) {
  const xs = [];
  let x = 0;
  script.slots.forEach((slot, i) => {
    xs.push(x);
    x += slot.advance || 0;
    if (i < script.slots.length - 1) x += isolGap;
  });
  return { xs, width: x };
}

export function slotBounds(script, opts = {}) {
  const isolGap = opts.isolGap || (script.family === "arabic" ? ISOL_GAP : 0);
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

/** Optical framing for Nastaliq so tall diagonals don't shrink the name. */
export function displayMetrics(script, opts = {}) {
  const m = slotBounds(script, opts);
  if (script.family !== "arabic") return m;
  const inkCy = (m.minY + m.maxY) / 2;
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

export function setViewBox(svg, metrics) {
  const pad = metrics.height * (metrics.tight ? 0.04 : 0.1);
  svg.setAttribute(
    "viewBox",
    `0 ${metrics.minY - pad} ${Math.max(metrics.width, 1)} ${metrics.height + pad * 2}`
  );
}

/** Fit `to` into `from`'s em so the outgoing script doesn't resize mid-morph. */
export function morphToFit(from, to) {
  const fromM = displayMetrics(from);
  const toM = displayMetrics(to);
  const scale = toM.height > 0 ? fromM.height / toM.height : 1;
  const fromCy = (fromM.minY + fromM.maxY) / 2;
  const toCy = ((toM.minY + toM.maxY) / 2) * scale;
  return { scale, dy: fromCy - toCy, fromM, toM };
}

export function rtlXs(script, isolGap = 0) {
  const n = script.slots.length;
  const xs = new Array(n);
  let x = 0;
  for (let visual = 0; visual < n; visual++) {
    const logical = n - 1 - visual;
    xs[logical] = x;
    x += (script.slots[logical].advance || 0) + (visual < n - 1 ? isolGap : 0);
  }
  return { xs, width: x };
}
