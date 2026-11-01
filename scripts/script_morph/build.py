#!/usr/bin/env python3
"""Build precomputed Bezier/outline JSON for a script-morph phrase.

Usage:
  python3 scripts/script_morph/build.py [_data/script_phrases/soham_korade.yaml]

Manual input: phrase YAML (slot alignment + families).
Automatic: HarfBuzz shaping + glyph outline extraction + path resampling.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import unicodedata
from pathlib import Path

import uharfbuzz as hb
import yaml
from fontTools.misc.transform import Transform
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ZWNJ = "\u200C"
DOTTED_CIRCLE = "\u25CC"

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FONTS = Path(__file__).with_name("fonts.yaml")
LOCAL_FONTS = Path(__file__).with_name("fonts.local.yaml")
SAMPLE_POINTS = 96
UPM_TARGET = 1000.0


class FlattenPen(BasePen):
    """Record path as line segments for resampling."""

    def __init__(self, glyph_set, flatness: float = 0.5):
        super().__init__(glyph_set)
        self.flatness = flatness
        self.contours: list[list[tuple[float, float]]] = []
        self._current: list[tuple[float, float]] = []

    def _moveTo(self, pt):
        if self._current:
            self.contours.append(self._current)
        self._current = [pt]

    def _lineTo(self, pt):
        self._current.append(pt)

    def _curveToOne(self, p1, p2, p3):
        self._cubic_flat(self._current[-1], p1, p2, p3)

    def _qCurveToOne(self, p1, p2):
        # Approximate quadratic as cubic
        p0 = self._current[-1]
        c1 = (p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1]))
        c2 = (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1]))
        self._cubic_flat(p0, c1, c2, p2)

    def _closePath(self):
        if self._current:
            if self._current[0] != self._current[-1]:
                self._current.append(self._current[0])
            self.contours.append(self._current)
            self._current = []

    def _endPath(self):
        if self._current:
            self.contours.append(self._current)
            self._current = []

    def _cubic_flat(self, p0, p1, p2, p3, depth: int = 0):
        if depth > 8 or self._cubic_flat_enough(p0, p1, p2, p3):
            self._current.append(p3)
            return
        # de Casteljau split
        p01 = _mid(p0, p1)
        p12 = _mid(p1, p2)
        p23 = _mid(p2, p3)
        p012 = _mid(p01, p12)
        p123 = _mid(p12, p23)
        p0123 = _mid(p012, p123)
        self._cubic_flat(p0, p01, p012, p0123, depth + 1)
        self._cubic_flat(p0123, p123, p23, p3, depth + 1)

    def _cubic_flat_enough(self, p0, p1, p2, p3) -> bool:
        ux = 3 * p1[0] - 2 * p0[0] - p3[0]
        uy = 3 * p1[1] - 2 * p0[1] - p3[1]
        vx = 3 * p2[0] - 2 * p3[0] - p0[0]
        vy = 3 * p2[1] - 2 * p3[1] - p0[1]
        return max(ux * ux + uy * uy, vx * vx + vy * vy) <= self.flatness * self.flatness


def _mid(a, b):
    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)


def load_yaml(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_font_map() -> dict:
    data = load_yaml(DEFAULT_FONTS)
    if LOCAL_FONTS.exists():
        local = load_yaml(LOCAL_FONTS)
        data["fonts"] = {**data.get("fonts", {}), **local.get("fonts", {})}
    return data["fonts"]


def open_ttfont(path: Path, face_index: int = 0) -> TTFont:
    if path.suffix.lower() == ".ttc":
        return TTFont(path, fontNumber=face_index)
    return TTFont(path)


def isolate_joining_text(text: str) -> str:
    """Insert ZWNJ between letters so Arabic/Urdu take isolated forms (marks stay with bases)."""
    if not text or text.isspace():
        return text
    out: list[str] = []
    for i, ch in enumerate(text):
        if i > 0:
            prev = text[i - 1]
            cat = unicodedata.category(ch)
            if cat.startswith("M"):
                out.append(ch)
                continue
            if ch in (" ", ZWNJ) or prev in (" ", ZWNJ):
                out.append(ch)
                continue
            out.append(ZWNJ)
        out.append(ch)
    return "".join(out)


def split_atoms(text: str) -> list[str]:
    """Split a cell into base + combining-mark atoms (Akshar matras=True style).

    Bases (letters, digits, symbols) accumulate; each Mn/Mc mark
    (matra, virama, anusvāra, …) is emitted as its own atom.
    """
    if not text or text.isspace():
        return [text]
    atoms: list[str] = []
    buf = ""
    for ch in text:
        if unicodedata.category(ch).startswith("M"):
            if buf:
                atoms.append(buf)
                buf = ""
            atoms.append(ch)
        else:
            buf += ch
    if buf:
        atoms.append(buf)
    return atoms or [text]


def shape_text(font_bytes: bytes, face_index: int, text: str, direction: str | None = None):
    face = hb.Face(font_bytes, face_index)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    if direction == "rtl":
        buf.direction = "rtl"
    elif direction == "ltr":
        buf.direction = "ltr"
    hb.shape(font, buf)
    return list(buf.glyph_infos), list(buf.glyph_positions), face.upem


def contours_to_svg(contours: list[list[tuple[float, float]]]) -> str:
    parts = []
    for contour in contours:
        if len(contour) < 2:
            continue
        cmds = [f"M{contour[0][0]:.2f} {contour[0][1]:.2f}"]
        for x, y in contour[1:]:
            cmds.append(f"L{x:.2f} {y:.2f}")
        cmds.append("Z")
        parts.append("".join(cmds))
    return "".join(parts)


def resample_contours(contours: list[list[tuple[float, float]]], n: int) -> list[list[float]]:
    """Resample all contours into n total points (distributed by length)."""
    segments: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    total = 0.0
    for contour in contours:
        for i in range(len(contour) - 1):
            a, b = contour[i], contour[i + 1]
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            if d > 1e-6:
                segments.append((a, b, d))
                total += d
    if total < 1e-6 or not segments:
        return [[0.0, 0.0] for _ in range(n)]

    points: list[list[float]] = []
    for i in range(n):
        target = (i / n) * total
        acc = 0.0
        for a, b, d in segments:
            if acc + d >= target or (a, b, d) is segments[-1]:
                t = 0.0 if d < 1e-9 else (target - acc) / d
                t = min(max(t, 0.0), 1.0)
                points.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
                break
            acc += d
    # Ensure length
    while len(points) < n:
        points.append(points[-1] if points else [0.0, 0.0])
    return points[:n]


def extract_slot(
    font_path: Path,
    face_index: int,
    text: str,
    direction: str = "ltr",
    features: dict | None = None,
    skip_dotted_circle: bool = False,
) -> dict:
    """Shape `text` and return path + resampled points in a y-up, UPM_TARGET space."""
    if text == "" or text.isspace():
        font_bytes = font_path.read_bytes()
        face = hb.Face(font_bytes, face_index)
        font = hb.Font(face)
        scale = UPM_TARGET / face.upem
        buf = hb.Buffer()
        buf.add_str(" ")
        buf.guess_segment_properties()
        hb.shape(font, buf)
        adv = buf.glyph_positions[0].x_advance * scale if buf.glyph_positions else UPM_TARGET * 0.3
        return {
            "text": text,
            "path": "",
            "points": [[0.0, 0.0] for _ in range(SAMPLE_POINTS)],
            "advance": round(adv, 2),
            "bounds": [0, 0, round(adv, 2), 0],
            "empty": True,
        }

    font_bytes = font_path.read_bytes()
    infos, positions, upem = shape_text(font_bytes, face_index, text, direction)
    scale = UPM_TARGET / upem

    tt = open_ttfont(font_path, face_index)
    glyph_set = tt.getGlyphSet()
    glyph_order = tt.getGlyphOrder()
    cmap = tt.getBestCmap() or {}
    dotted_name = cmap.get(ord(DOTTED_CIRCLE)) if skip_dotted_circle else None

    recording = RecordingPen()
    x_cursor = 0.0
    for info, pos in zip(infos, positions):
        gid = info.codepoint
        if gid >= len(glyph_order):
            x_cursor += pos.x_advance
            continue
        name = glyph_order[gid]
        if dotted_name and name == dotted_name:
            continue
        if name not in glyph_set:
            x_cursor += pos.x_advance
            continue
        dx = (x_cursor + pos.x_offset) * scale
        dy = pos.y_offset * scale
        transform = Transform(scale, 0, 0, scale, dx, dy)
        tpen = TransformPen(recording, transform)
        glyph_set[name].draw(tpen)
        x_cursor += pos.x_advance

    flat = FlattenPen(glyph_set)
    recording.replay(flat)
    if flat._current:
        flat.contours.append(flat._current)

    bpen = BoundsPen(glyph_set)
    recording.replay(bpen)
    if bpen.bounds:
        xmin, ymin, xmax, ymax = bpen.bounds
    else:
        xmin = ymin = 0.0
        xmax = x_cursor * scale
        ymax = UPM_TARGET * 0.8

    path = contours_to_svg(flat.contours)
    points = resample_contours(flat.contours, SAMPLE_POINTS)
    advance = x_cursor * scale

    tt.close()
    return {
        "text": text,
        "path": path,
        "points": [[round(x, 2), round(y, 2)] for x, y in points],
        "advance": round(advance, 2),
        "bounds": [round(xmin, 2), round(ymin, 2), round(xmax, 2), round(ymax, 2)],
        "empty": not bool(path),
    }


def extract_atoms(
    font_path: Path,
    face_index: int,
    cell: str,
    direction: str = "ltr",
) -> list[dict] | None:
    """Shape matra-level atoms for a cell; None when the cell is a single atom."""
    parts = split_atoms(cell)
    if len(parts) <= 1:
        return None
    atoms = []
    for part in parts:
        mark_only = bool(part) and all(unicodedata.category(ch).startswith("M") for ch in part)
        outline = extract_slot(
            font_path,
            face_index,
            part,
            direction=direction,
            skip_dotted_circle=mark_only,
        )
        outline["text"] = part
        atoms.append(outline)
    return atoms


def build_joined(script: dict, font_path: Path, face_index: int) -> dict:
    """Full-string joined outline (used for Arabic join act)."""
    cells = script["cells"]
    full = "".join(cells)
    return extract_slot(font_path, face_index, full, direction=script.get("dir", "ltr"))


def build_join_steps(script: dict, font_path: Path, face_index: int) -> list:
    """Cumulative joined prefixes (logical 0..k) for one-by-one RTL combining."""
    cells = script["cells"]
    direction = script.get("dir", "ltr")
    steps = []
    for end in range(len(cells)):
        text = "".join(cells[: end + 1])
        step = extract_slot(font_path, face_index, text, direction=direction)
        step["through"] = end  # inclusive logical index
        steps.append(step)
    return steps


def build_phrase(phrase_path: Path, fonts: dict) -> dict:
    phrase = load_yaml(phrase_path)
    scripts_out = []
    slot_count = None

    for script in phrase["scripts"]:
        font_id = script["font"]
        if font_id not in fonts:
            raise SystemExit(f"Unknown font id '{font_id}' for script '{script['id']}'")
        font_meta = fonts[font_id]
        font_path = Path(font_meta["path"])
        if not font_path.exists():
            raise SystemExit(f"Font not found: {font_path} (script {script['id']})")
        face_index = int(font_meta.get("face_index", 0))
        cells = script["cells"]
        if slot_count is None:
            slot_count = len(cells)
        elif len(cells) != slot_count:
            raise SystemExit(
                f"Script '{script['id']}' has {len(cells)} cells; expected {slot_count}"
            )

        print(f"  shaping {script['id']}…")
        direction = script.get("dir", "ltr")
        slots = []
        for cell in cells:
            shaped = isolate_joining_text(cell) if script.get("join") else cell
            slot = extract_slot(font_path, face_index, shaped, direction=direction)
            slot["text"] = cell
            atoms = extract_atoms(font_path, face_index, cell, direction=direction)
            if atoms:
                slot["atoms"] = atoms
            slots.append(slot)
        entry = {
            "id": script["id"],
            "label": script["label"],
            "family": script["family"],
            "dir": direction,
            "font": font_id,
            "cells": cells,
            "slots": slots,
        }
        # Latin: also emit lowercase outlines for case-fold before/after morph.
        if script["id"] == "latin" or script.get("case_fold"):
            print(f"  shaping {script['id']} (lowercase)…")
            lower_slots = []
            for cell in cells:
                lower = cell.lower()
                lower_slots.append(
                    extract_slot(
                        font_path,
                        face_index,
                        lower,
                        direction=script.get("dir", "ltr"),
                    )
                )
                lower_slots[-1]["text"] = lower
            entry["slots_lower"] = lower_slots
        # Generalized post-morph composition (attach marks, cursive join, …).
        compose = script.get("compose") or {}
        if script.get("join") and not compose:
            compose = {"mode": "cursive", "term": "Cursive joining"}
        if compose:
            entry["compose"] = {
                "mode": compose.get("mode", "attach"),
                "term": compose.get("term"),
                "steps": [],
            }
            mode = entry["compose"]["mode"]
            if mode == "cursive":
                print(f"  shaping {script['id']} (cursive compose)…")
                entry["joined"] = build_joined(script, font_path, face_index)
                entry["join_steps"] = build_join_steps(script, font_path, face_index)
                entry["compose"]["term"] = compose.get("term") or "Cursive joining"
            elif mode == "attach":
                print(f"  shaping {script['id']} (attach compose)…")
                for step in compose.get("steps") or []:
                    idxs = list(step["slots"])
                    text = "".join(cells[i] for i in idxs)
                    outline = extract_slot(
                        font_path, face_index, text, direction=direction
                    )
                    entry["compose"]["steps"].append(
                        {
                            "slots": idxs,
                            "term": step.get("term") or "Mark attachment",
                            "text": text,
                            "path": outline["path"],
                            "points": outline["points"],
                            "advance": outline["advance"],
                            "bounds": outline["bounds"],
                            "empty": outline["empty"],
                        }
                    )
        scripts_out.append(entry)

    return {
        "id": phrase["id"],
        "accessible_name": phrase["accessible_name"],
        "upem": UPM_TARGET,
        "sample_points": SAMPLE_POINTS,
        "carousel": phrase["carousel"],
        "families": phrase["families"],
        "scripts": scripts_out,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "phrase",
        nargs="?",
        default=str(ROOT / "_data/script_phrases/soham_korade.yaml"),
        help="Path to phrase YAML",
    )
    parser.add_argument(
        "-o",
        "--out",
        default=None,
        help="Output JSON path (default: assets/data/script_morph/<id>.json)",
    )
    args = parser.parse_args()
    phrase_path = Path(args.phrase)
    fonts = load_font_map()

    print(f"Building {phrase_path}…")
    data = build_phrase(phrase_path, fonts)
    out = Path(args.out) if args.out else ROOT / "assets/data/script_morph" / f"{data['id']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = out.stat().st_size / 1024
    print(f"Wrote {out} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        raise
