# Script morph outline pipeline

Generates Bezier/resampled outlines for the homepage script-morph widget.

```bash
pip install -r scripts/script_morph/requirements.txt
python3 scripts/script_morph/build.py
# → assets/data/script_morph/soham_korade.json
```

- **Manual:** `_data/script_phrases/<id>.yaml` (slot alignment, families, fonts)
- **Fonts:** `fonts.yaml` (override with `fonts.local.yaml`)
- **Automatic:** HarfBuzz shaping + glyph outlines + resampling
