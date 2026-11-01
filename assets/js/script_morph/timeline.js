import { MS, slotsEqual, scaleDuration, easeInOut } from "./util.js";

export function countChangedSlots(a, b) {
  if (!a?.slots || !b?.slots) return 0;
  let n = 0;
  for (let i = 0; i < a.slots.length; i++) {
    if (!slotsEqual(a.slots[i], b.slots[i])) n += 1;
  }
  return n;
}

export function morphDurationMs(from, to, opts = {}) {
  const changed = countChangedSlots(from, to);
  const slotMs = opts.duration || MS.slotMorph;
  const prep = opts.sameScript || opts.skipPrep ? 0 : MS.slotPrep;
  const gaps = Math.max(0, changed - 1) * MS.slotGap;
  return prep + changed * slotMs + gaps;
}

function withLower(script) {
  return script.slots_lower ? { ...script, slots: script.slots_lower } : script;
}

/** Build seekable segments for from→to. Durations already scaled for compact/fullscreen. */
export function planTimeline(from, to, fullscreen) {
  const segments = [];
  let t = 0;
  const add = (id, label, baseMs) => {
    const duration = scaleDuration(baseMs, fullscreen);
    segments.push({ id, label, start: t, end: t + duration, duration, baseMs });
    t += duration;
  };

  let morphFrom = from;
  if (from.id === "latin" && from.slots_lower) {
    add(
      "case-out",
      "Case folding",
      morphDurationMs(from, withLower(from), { duration: MS.caseFold, sameScript: true })
    );
    morphFrom = withLower(from);
  }

  let morphTo = to;
  const enteringLatin = to.id === "latin" && to.slots_lower;
  if (enteringLatin) morphTo = withLower(to);

  const enteringCursive = to.compose?.mode === "cursive";
  const leavingCursive = from.compose?.mode === "cursive";

  if (enteringCursive) {
    add("reverse", "Reading-order reversal", MS.reverse);
    add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
    add("spread", "Isolation spacing", MS.spread);
    const joinSteps = (to.join_steps || []).length || to.slots.length;
    add(
      "join",
      to.compose.term || "Cursive joining",
      joinSteps * MS.joinStep + Math.max(0, joinSteps - 1) * MS.joinGap
    );
  } else if (leavingCursive) {
    add("segregate", "Cursive segregation", MS.segregate);
    add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
    add("unreverse", "Reading-order reversal", MS.reverse);
  } else {
    add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
  }

  if (to.compose?.mode === "attach") {
    const steps = (to.compose.steps || []).length || 1;
    add(
      "attach",
      to.compose.steps?.[0]?.term || to.compose.term || "Mark attachment",
      steps * MS.joinStep
    );
  }

  if (enteringLatin) {
    add(
      "case-in",
      "Case folding",
      morphDurationMs(withLower(to), to, { duration: MS.caseFold, sameScript: true })
    );
  }

  add("settle", "Metric settling", MS.settle);
  return { segments, total: Math.max(t, 1), from, to, morphFrom, morphTo, enteringLatin };
}

function segmentAt(plan, ms) {
  const clamped = Math.max(0, Math.min(plan.total, ms));
  for (const seg of plan.segments) {
    if (clamped <= seg.end || seg === plan.segments[plan.segments.length - 1]) {
      const local = seg.duration > 0 ? (clamped - seg.start) / seg.duration : 1;
      return { seg, local: Math.max(0, Math.min(1, local)), ms: clamped };
    }
  }
  const last = plan.segments[plan.segments.length - 1];
  return { seg: last, local: 1, ms: clamped };
}

/** Per-slot morph progress (0–1) + prep t for a morph segment's local time. */
export function morphProgress(from, to, localT, opts = {}) {
  const n = from.slots.length;
  const progress = new Array(n).fill(0);
  const changed = [];
  for (let i = 0; i < n; i++) {
    if (!slotsEqual(from.slots[i], to.slots[i])) changed.push(i);
    else progress[i] = 1;
  }

  const prepShare = opts.skipPrep ? 0 : MS.slotPrep;
  const slotMs = opts.duration || MS.slotMorph;
  const gapMs = MS.slotGap;
  const morphBase =
    changed.length * slotMs + Math.max(0, changed.length - 1) * gapMs;
  const totalBase = prepShare + morphBase;
  if (totalBase <= 0) return { progress, prepT: 1, changed };

  const localMs = localT * totalBase;
  let prepT = 1;
  let rem = localMs;
  if (prepShare > 0) {
    prepT = Math.min(1, rem / prepShare);
    rem = Math.max(0, rem - prepShare);
  }

  const order = opts.reversed ? [...changed].reverse() : changed;
  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    if (rem <= 0) break;
    if (rem < slotMs) {
      progress[idx] = easeInOut(rem / slotMs);
      rem = 0;
      break;
    }
    progress[idx] = 1;
    rem -= slotMs;
    if (i < order.length - 1) rem = Math.max(0, rem - gapMs);
  }
  return { progress, prepT: easeInOut(prepT), changed: order };
}

/** Join progress: absorbed count + local t within current step. */
export function joinProgress(script, localT) {
  const n = script.slots.length;
  const stepMs = MS.joinStep;
  const gapMs = MS.joinGap;
  const totalBase = n * stepMs + Math.max(0, n - 1) * gapMs;
  let rem = localT * totalBase;
  for (let step = 0; step < n; step++) {
    if (rem < stepMs) return { absorbed: step, t: easeInOut(rem / stepMs) };
    rem -= stepMs;
    if (step < n - 1) {
      if (rem < gapMs) return { absorbed: step, t: 1 };
      rem -= gapMs;
    }
  }
  return { absorbed: n, t: 1 };
}

/** Attach progress across compose steps. */
export function attachProgress(script, localT) {
  const steps = script.compose?.steps || [];
  if (!steps.length) return { step: 0, t: 1, steps };
  const stepMs = MS.joinStep;
  const totalBase = steps.length * stepMs;
  let rem = localT * totalBase;
  for (let i = 0; i < steps.length; i++) {
    if (rem < stepMs) return { step: i, t: easeInOut(rem / stepMs), steps };
    rem -= stepMs;
  }
  return { step: steps.length - 1, t: 1, steps };
}

/**
 * Pure snapshot at playhead ms. Paint reads this; play and scrub share it.
 */
export function stateAt(plan, ms) {
  const { seg, local, ms: clamped } = segmentAt(plan, ms);
  const eased = easeInOut(local);
  const { from, to, morphFrom, morphTo, enteringLatin } = plan;

  const base = {
    ms: clamped,
    segment: seg,
    label: seg.label,
    local,
    eased,
    from,
    to,
  };

  switch (seg.id) {
    case "case-out":
      return {
        ...base,
        kind: "morph",
        morphFrom: from,
        morphTo: withLower(from),
        ...morphProgress(from, withLower(from), local, {
          duration: MS.caseFold,
          skipPrep: true,
        }),
        sameScript: true,
        reversed: false,
      };
    case "case-in":
      return {
        ...base,
        kind: "morph",
        morphFrom: withLower(to),
        morphTo: to,
        ...morphProgress(withLower(to), to, local, {
          duration: MS.caseFold,
          skipPrep: true,
        }),
        sameScript: true,
        reversed: false,
      };
    case "reverse":
      return { ...base, kind: "reverse", script: morphFrom, t: eased };
    case "unreverse":
      return { ...base, kind: "unreverse", script: morphTo, t: eased };
    case "segregate":
      return { ...base, kind: "static", script: from, reversed: true, joined: false };
    case "morph": {
      const reversed =
        to.compose?.mode === "cursive" || from.compose?.mode === "cursive";
      return {
        ...base,
        kind: "morph",
        morphFrom,
        morphTo,
        ...morphProgress(morphFrom, morphTo, local, { reversed }),
        sameScript: false,
        reversed,
      };
    }
    case "spread":
      return { ...base, kind: "spread", script: morphTo, t: eased };
    case "join":
      return {
        ...base,
        kind: "join",
        script: to,
        ...joinProgress(to, local),
      };
    case "attach":
      return {
        ...base,
        kind: "attach",
        script: to,
        ...attachProgress(to, local),
      };
    case "settle": {
      const joined = to.compose?.mode === "cursive" && to.joined;
      return {
        ...base,
        kind: "settle",
        script: to,
        t: eased,
        joined: !!joined,
        enteringLatin,
      };
    }
    default:
      return { ...base, kind: "static", script: to, joined: false, reversed: false };
  }
}
