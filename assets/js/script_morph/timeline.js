import {
  MS,
  slotsEqual,
  scaleDuration,
  easeInOut,
  atomsOf,
  padAtoms,
} from "./util.js";

export function countChangedSlots(a, b) {
  if (!a?.slots || !b?.slots) return 0;
  let n = 0;
  for (let i = 0; i < a.slots.length; i++) {
    if (!slotsEqual(a.slots[i], b.slots[i])) n += 1;
  }
  return n;
}

function stepDuration(step, atomMs) {
  // Matra combine/discombine and anusvāra attach/detach share one grain.
  if (
    step.kind === "combine" ||
    step.kind === "discombine" ||
    step.kind === "attach" ||
    step.kind === "detach"
  ) {
    return MS.atomCombine;
  }
  return atomMs;
}

function isMarkStep(step) {
  return (
    step.kind === "combine" ||
    step.kind === "discombine" ||
    step.kind === "attach" ||
    step.kind === "detach"
  );
}

function gapBefore(prev, next) {
  if (!prev) return 0;
  // Anusvāra/pulli attach·detach is the same grain as matra combine·discombine.
  if (isMarkStep(next) || isMarkStep(prev)) {
    if (next.slot === prev.slot) return MS.atomGap;
    // Detach runs before the first changing slot; keep a short breath.
    if (prev.kind === "detach" || next.kind === "discombine") return MS.atomGap;
    return MS.slotGap;
  }
  if (next.slot !== prev.slot) return MS.slotGap;
  return MS.atomGap;
}

function attachPlans(script) {
  if (script.compose?.mode !== "attach") return [];
  return (script.compose.steps || []).filter(
    (st) => Array.isArray(st.slots) && st.slots.length >= 2 && st.path
  );
}

/**
 * Ordered leave-A → atom morph → settle-B steps.
 * Matras and anusvāras share one grain: discombine/detach, then atoms, then
 * combine/attach. Slot order is logical reading order (0→n). For RTL/cursive
 * layouts logical 0 sits on the right, so the animation runs right→left on screen.
 */
export function morphSteps(from, to, rtl = false) {
  const n = from.slots.length;
  const order = [];
  for (let i = 0; i < n; i++) {
    if (!slotsEqual(from.slots[i], to.slots[i])) order.push(i);
  }
  const changing = new Set(order);

  const attaches = attachPlans(to);
  const done = new Set();
  const fired = new Set();
  const steps = [];

  // Leave settled A: undo anusvāra/pulli merges that involve a changing slot.
  for (const st of attachPlans(from)) {
    const idxs = st.slots || [];
    if (idxs.length < 2 || !idxs.some((i) => changing.has(i))) continue;
    steps.push({
      kind: "detach",
      slot: idxs[0],
      markSlot: idxs[1],
      compose: st,
      atomCount: 2,
      atom: -1,
    });
  }

  const flushAttach = () => {
    for (const st of attaches) {
      if (fired.has(st)) continue;
      const idxs = st.slots;
      if (!idxs.every((i) => done.has(i))) continue;
      fired.add(st);
      steps.push({
        kind: "attach",
        slot: idxs[0],
        markSlot: idxs[1],
        compose: st,
        atomCount: 2,
        atom: -1,
      });
    }
  };

  for (const slot of order) {
    const fromAtoms = atomsOf(from.slots[slot]);
    const toAtoms = atomsOf(to.slots[slot]);
    const { n: atomN } = padAtoms(fromAtoms, toAtoms);
    // Leave settled A: split base|matra before correspondence.
    if (fromAtoms.length > 1) {
      steps.push({ slot, atom: -1, atomCount: atomN, kind: "discombine" });
    }
    // RTL: morph atoms right→left within the syllable (same reading grain).
    for (let i = 0; i < atomN; i++) {
      const atom = rtl ? atomN - 1 - i : i;
      steps.push({ slot, atom, atomCount: atomN, kind: "atom" });
    }
    // Settle B: merge matured atoms into the syllable outline.
    if (toAtoms.length > 1) {
      steps.push({ slot, atom: -1, atomCount: atomN, kind: "combine" });
    }
    done.add(slot);
    flushAttach();
  }
  return steps;
}

function morphBodyMs(steps, atomMs) {
  if (!steps.length) return 0;
  let ms = 0;
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) ms += gapBefore(steps[i - 1], steps[i]);
    ms += stepDuration(steps[i], atomMs);
  }
  return ms;
}

export function morphDurationMs(from, to, opts = {}) {
  const atomMs = opts.duration || MS.atomMorph;
  const prep = opts.sameScript || opts.skipPrep ? 0 : MS.slotPrep;
  const steps = morphSteps(from, to, false);
  return prep + morphBodyMs(steps, atomMs);
}

function withLower(script) {
  return script.slots_lower ? { ...script, slots: script.slots_lower } : script;
}

function fineTicksForMorph(morphStart, from, to, reversed, fullscreen, opts = {}) {
  const atomMs = opts.duration || MS.atomMorph;
  const prep = opts.skipPrep ? 0 : MS.slotPrep;
  const steps = morphSteps(from, to, reversed);
  const ticks = [];
  let acc = morphStart + scaleDuration(prep, fullscreen);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    ticks.push({
      ms: acc,
      label:
        step.kind === "attach"
          ? step.compose?.term || "Mark combination"
          : step.kind === "detach"
            ? step.compose?.term
              ? `${step.compose.term} (leave)`
              : "Mark separation"
            : step.kind === "combine"
              ? "Matra combination"
              : step.kind === "discombine"
                ? "Matra separation"
                : step.atomCount > 1
                  ? "Matra correspondence"
                  : "Grapheme correspondence",
      fine: true,
    });
    acc += scaleDuration(stepDuration(step, atomMs), fullscreen);
    if (i < steps.length - 1) {
      acc += scaleDuration(gapBefore(step, steps[i + 1]), fullscreen);
    }
  }
  return ticks;
}

/** Build seekable segments for from→to. Durations already scaled for compact/fullscreen. */
export function planTimeline(from, to, fullscreen) {
  const segments = [];
  const fineTicks = [];
  let t = 0;
  const add = (id, label, baseMs) => {
    const duration = scaleDuration(baseMs, fullscreen);
    segments.push({ id, label, start: t, end: t + duration, duration, baseMs });
    t += duration;
  };

  let morphFrom = from;
  if (from.id === "latin" && from.slots_lower) {
    const start = t;
    add(
      "case-out",
      "Case folding",
      morphDurationMs(from, withLower(from), { duration: MS.caseFold, sameScript: true })
    );
    fineTicks.push(
      ...fineTicksForMorph(start, from, withLower(from), false, fullscreen, {
        duration: MS.caseFold,
        skipPrep: true,
      })
    );
    morphFrom = withLower(from);
  }

  let morphTo = to;
  const enteringLatin = to.id === "latin" && to.slots_lower;
  if (enteringLatin) morphTo = withLower(to);

  const enteringCursive = to.compose?.mode === "cursive";
  const leavingCursive = from.compose?.mode === "cursive";
  const morphReversed = enteringCursive || leavingCursive;

  if (enteringCursive) {
    add("reverse", "Reading-order reversal", MS.reverse);
    {
      const start = t;
      add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
      fineTicks.push(
        ...fineTicksForMorph(start, morphFrom, morphTo, true, fullscreen)
      );
    }
    add("spread", "Isolation spacing", MS.spread);
    const joinSteps = (to.join_steps || []).length || to.slots.length;
    add(
      "join",
      to.compose.term || "Cursive joining",
      joinSteps * MS.joinStep + Math.max(0, joinSteps - 1) * MS.joinGap
    );
  } else if (leavingCursive) {
    add("segregate", "Cursive segregation", MS.segregate);
    {
      const start = t;
      add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
      fineTicks.push(
        ...fineTicksForMorph(start, morphFrom, morphTo, true, fullscreen)
      );
    }
    add("unreverse", "Reading-order reversal", MS.reverse);
  } else {
    const start = t;
    add("morph", "Grapheme correspondence", morphDurationMs(morphFrom, morphTo));
    fineTicks.push(
      ...fineTicksForMorph(start, morphFrom, morphTo, false, fullscreen)
    );
  }

  // Attach (anusvāra / pulli) runs inline in the morph segment like matra combine.

  if (enteringLatin) {
    const start = t;
    add(
      "case-in",
      "Case folding",
      morphDurationMs(withLower(to), to, { duration: MS.caseFold, sameScript: true })
    );
    fineTicks.push(
      ...fineTicksForMorph(start, withLower(to), to, false, fullscreen, {
        duration: MS.caseFold,
        skipPrep: true,
      })
    );
  }

  add("settle", "Metric settling", MS.settle);
  return {
    segments,
    fineTicks,
    total: Math.max(t, 1),
    from,
    to,
    morphFrom,
    morphTo,
    enteringLatin,
    morphReversed,
  };
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

/** Per-slot + per-matra morph progress for a morph segment's local time. */
export function morphProgress(from, to, localT, opts = {}) {
  const n = from.slots.length;
  const steps = morphSteps(from, to, opts.reversed);
  const progress = new Array(n).fill(0);
  const discombineProgress = new Array(n).fill(0);
  const combineProgress = new Array(n).fill(0);
  const detachProgress = new Array(n).fill(1);
  const attachProgress = new Array(n).fill(0);
  const atomProgress = Array.from({ length: n }, (_, i) => {
    const fromAtoms = atomsOf(from.slots[i]);
    const toAtoms = atomsOf(to.slots[i]);
    const { n: k } = padAtoms(fromAtoms, toAtoms);
    const equal = slotsEqual(from.slots[i], to.slots[i]);
    // Unchanged / single-side slots skip that pass (treat as already done).
    if (equal || fromAtoms.length <= 1) discombineProgress[i] = 1;
    if (equal || toAtoms.length <= 1) combineProgress[i] = 1;
    return new Array(k).fill(equal ? 1 : 0);
  });

  for (const step of steps) {
    if (step.kind === "detach") detachProgress[step.slot] = 0;
  }

  for (let i = 0; i < n; i++) {
    if (slotsEqual(from.slots[i], to.slots[i])) progress[i] = 1;
  }

  const atomMs = opts.duration || MS.atomMorph;
  const prepShare = opts.skipPrep ? 0 : MS.slotPrep;
  const morphBase = morphBodyMs(steps, atomMs);
  const totalBase = prepShare + morphBase;
  if (totalBase <= 0) {
    return {
      progress,
      atomProgress,
      discombineProgress,
      combineProgress,
      detachProgress,
      attachProgress,
      prepT: 1,
      changed: steps.map((s) => s.slot),
    };
  }

  const localMs = localT * totalBase;
  let prepT = 1;
  let rem = localMs;
  if (prepShare > 0) {
    prepT = Math.min(1, rem / prepShare);
    rem = Math.max(0, rem - prepShare);
  }

  const applyStep = (step, t) => {
    if (step.kind === "attach") attachProgress[step.slot] = t;
    else if (step.kind === "detach") detachProgress[step.slot] = t;
    else if (step.kind === "combine") combineProgress[step.slot] = t;
    else if (step.kind === "discombine") discombineProgress[step.slot] = t;
    else atomProgress[step.slot][step.atom] = t;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const dur = stepDuration(step, atomMs);
    if (rem <= 0) break;
    if (rem < dur) {
      applyStep(step, easeInOut(rem / dur));
      rem = 0;
      break;
    }
    applyStep(step, 1);
    rem -= dur;
    if (i < steps.length - 1) {
      rem = Math.max(0, rem - gapBefore(step, steps[i + 1]));
    }
  }

  for (let i = 0; i < n; i++) {
    const ap = atomProgress[i];
    if (!ap?.length) {
      progress[i] = 1;
      continue;
    }
    const atomAvg = ap.reduce((s, v) => s + v, 0) / ap.length;
    const parts = [
      discombineProgress[i] || 0,
      atomAvg,
      combineProgress[i] || 0,
    ];
    // Detach starts at 1 when unused; only count when a leave-attach ran.
    if (steps.some((s) => s.kind === "detach" && s.slot === i)) {
      parts.unshift(detachProgress[i] || 0);
    }
    if (attachProgress[i]) parts.push(attachProgress[i]);
    progress[i] = parts.reduce((s, v) => s + v, 0) / parts.length;
  }

  const changed = [
    ...new Set(
      steps.flatMap((s) =>
        s.kind === "attach" || s.kind === "detach"
          ? [s.slot, s.markSlot]
          : [s.slot]
      )
    ),
  ];
  return {
    progress,
    atomProgress,
    discombineProgress,
    combineProgress,
    detachProgress,
    attachProgress,
    prepT: easeInOut(prepT),
    changed,
  };
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
