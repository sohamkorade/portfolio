import { paintMorph, paintStatic, paintReverse } from "./morph.js";
import { paintSpread, paintJoin, paintAttach, paintSettle } from "./compose.js";

/** Paint a stateAt snapshot into the SVG. */
export function paint(svg, state) {
  if (!svg || !state) return;
  const hoverSlot = state.hoverSlot;
  switch (state.kind) {
    case "morph":
      paintMorph(svg, state);
      break;
    case "reverse":
      paintReverse(svg, state.script, state.t, false);
      break;
    case "unreverse":
      paintReverse(svg, state.script, state.t, true);
      break;
    case "spread":
      paintSpread(svg, state.script, state.t);
      break;
    case "join":
      paintJoin(svg, state.script, state.absorbed, state.t);
      break;
    case "attach":
      paintAttach(svg, state.script, state.step, state.t);
      break;
    case "settle":
      paintSettle(svg, state.script, state.t, {
        joined: state.joined,
        from: state.from,
        hoverSlot,
      });
      break;
    case "static":
    default:
      paintStatic(svg, state.script || state.to, {
        joined: state.joined,
        reversed: state.reversed,
        hoverSlot,
      });
      break;
  }
}

export function paintScript(svg, script, opts = {}) {
  paintStatic(svg, script, opts);
}
