export const STORAGE_KEY = "script-morph-index";
export const COMPACT_SPEED = 0.42;
export const COMPACT_SCRIPTS = [
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

export const MS = {
  atomMorph: 360, // per base/matra unit
  atomGap: 40, // gap between matras inside one syllable
  atomCombine: 320, // matra/anusvāra combine·discombine·attach·detach
  slotMorph: 480, // legacy alias; morph timing uses atomMorph
  slotGap: 70, // gap between syllable slots
  caseFold: 320,
  settle: 520,
  slotPrep: 520,
  spread: 560,
  reverse: 1100,
  joinStep: 1400,
  joinGap: 220,
  segregate: 80,
};

const EMPTY_ATOM = {
  text: "",
  path: "",
  points: [],
  advance: 0,
  bounds: [0, 0, 0, 0],
  empty: true,
};

/** Morph grain: base + matras when present, else the whole slot. */
export function atomsOf(slot) {
  if (!slot) return [{ ...EMPTY_ATOM }];
  if (slot.atoms?.length) return slot.atoms;
  return [slot];
}

export function padAtoms(a, b) {
  const n = Math.max(a.length, b.length, 1);
  const left = a.slice();
  const right = b.slice();
  while (left.length < n) left.push({ ...EMPTY_ATOM });
  while (right.length < n) right.push({ ...EMPTY_ATOM });
  return { from: left, to: right, n };
}

export const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const NS = "http://www.w3.org/2000/svg";
export const ISOL_GAP = 120;
export const BOX_PAD = 28;

export function pointsToPath(points) {
  if (!points || !points.length) return "";
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i][0]} ${points[i][1]}`;
  return d + "Z";
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function scriptById(data, id) {
  return data.scripts.find((s) => s.id === id);
}

export function slotsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.empty && b.empty) return true;
  const pa = a.path || "";
  const pb = b.path || "";
  if (pa || pb) return pa === pb;
  return (
    (a.text != null ? a.text : "") === (b.text != null ? b.text : "") &&
    (a.advance || 0) === (b.advance || 0)
  );
}

export function slotPath(slot) {
  return slot.path || pointsToPath(slot.points);
}

export function el(name, attrs = {}, kids = []) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "className") node.setAttribute("class", v);
    else if (k === "textContent") node.textContent = v;
    else node.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) node.appendChild(kid);
  return node;
}

export function scaleDuration(base, fullscreen) {
  if (!base) return 0;
  return fullscreen ? base : Math.max(40, base * COMPACT_SPEED);
}

/** Merge attach-compose mark slots into base outlines for resting display. */
export function resolveAttachedSlots(script) {
  if (script.compose?.mode !== "attach") return script.slots;
  const steps = script.compose.steps || [];
  if (!steps.length) return script.slots;

  const absorbed = new Set();
  const overrides = new Map();
  for (const step of steps) {
    const idxs = step.slots || [];
    if (idxs.length < 2 || !step.path) continue;
    const base = idxs[0];
    overrides.set(base, {
      ...script.slots[base],
      text: step.text || script.slots[base].text,
      path: step.path,
      points: step.points,
      advance: step.advance,
      bounds: step.bounds,
      empty: !!step.empty,
      atoms: undefined,
    });
    idxs.slice(1).forEach((i) => absorbed.add(i));
  }
  if (!overrides.size) return script.slots;

  return script.slots.map((slot, i) => {
    if (absorbed.has(i)) {
      return {
        text: "",
        path: "",
        points: [],
        advance: 0,
        bounds: [0, 0, 0, 0],
        empty: true,
      };
    }
    return overrides.get(i) || slot;
  });
}
