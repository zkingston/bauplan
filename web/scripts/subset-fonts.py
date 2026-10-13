"""Make the Jost font files in the repository smaller, in place, for a production build.

The script keeps printable ASCII, all other characters in the source of the game, and only the
weight range that the CSS uses. The CI workflow runs it before `npm run build`. Development uses
the full files.
Run: uv run --no-project --with fonttools --with brotli python web/scripts/subset-fonts.py
"""

import io
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parents[1]
FONTS = WEB / "src" / "assets" / "fonts"

texts = [p.read_text(encoding="utf8") for p in [WEB / "index.html", *WEB.glob("src/**/*.*")]
         if p.suffix in {".ts", ".json", ".css", ".html"}]  # fmt: skip
chars = set(range(0x20, 0x7F)) | {ord(c) for t in texts for c in t if ord(c) > 0x7E}

css = "".join(p.read_text(encoding="utf8") for p in sorted((WEB / "src" / "styles").glob("*.css")))
named = {"normal": 400, "bold": 700}
weights = {400} | {
    int(w) if w.isdigit() else named[w]
    for w in re.findall(r"font-weight:\s*(\d+|normal|bold)\s*;", css)
}
lo, hi = min(weights), max(weights)

for path in sorted(FONTS.glob("*.woff2")):
    before = path.stat().st_size
    # Subset a saved copy of the instance. A subset of the instance in memory fails, because its
    # glyph variations load lazily.
    buf = io.BytesIO()
    instancer.instantiateVariableFont(TTFont(path), {"wght": (lo, hi)}).save(buf)
    font = TTFont(io.BytesIO(buf.getvalue()))
    cmap = font.getBestCmap() or {}
    keep = sorted(c for c in chars if c in cmap)
    sub = subset.Subsetter(subset.Options())
    sub.populate(unicodes=keep)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(path)
    print(
        f"{path.name}: {len(keep)} glyphs, weight {lo}-{hi}, {before} -> {path.stat().st_size} bytes"
    )
