"""Generate the PWA icons + wordmark from the Real Health brand logo.

Run from the repo root:  python3 icons/make_icons.py
Source logos live outside this repo (see SRC_DIR).
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SRC_DIR = Path("/home/roel/Documents/PersonalRepos/Kombucha/assets/design-logos")
OUT = Path(__file__).resolve().parent
GREEN, CREAM, GOLD = (28, 57, 45), (245, 240, 232), (212, 175, 85)


def mark_on_green():
    """Sun rays + Madeira island (no wordmark), recoloured onto dark green."""
    src = Image.open(SRC_DIR / "logo_highres.png").convert("RGB")
    a = np.asarray(src.crop((395, 300, 1535, 1000))).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    island = (r < 90) & (g < 110) & (b < 100)
    gold = (r > 150) & (b < 150) & (r - b > 60) & ~island
    dot = np.zeros_like(gold)
    dot[300:, 300:800] = gold[300:, 300:800]  # the Funchal dot, drawn over the island

    def mask(m, grow=0):
        im = Image.fromarray((m * 255).astype("uint8"))
        return im.filter(ImageFilter.MaxFilter(grow)) if grow else im

    h, w = island.shape
    c = Image.new("RGB", (w, h), GREEN)
    c.paste(Image.new("RGB", (w, h), GOLD), (0, 0), mask(gold, 7))  # thicken rays for small sizes
    c.paste(Image.new("RGB", (w, h), CREAM), (0, 0), mask(island))
    c.paste(Image.new("RGB", (w, h), GOLD), (0, 0), mask(dot, 5))
    return c


def square(mark, side):
    sq = Image.new("RGB", (side, side), GREEN)
    sq.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2 + side // 25))
    return sq


def main():
    mark = mark_on_green()
    regular = square(mark, 1400)   # mark fills ~81% width
    maskable = square(mark, 1840)  # mark within the 80% safe-zone circle
    for name, img, size in [
        ("icon-512.png", regular, 512), ("icon-192.png", regular, 192),
        ("apple-touch-icon.png", regular, 180), ("favicon-32.png", regular, 32),
        ("icon-maskable-512.png", maskable, 512),
    ]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

    logo = Image.open(SRC_DIR / "logo_variant_A.png").convert("RGB")
    bg = Image.new("RGB", logo.size, logo.getpixel((5, 5)))
    diff = np.asarray(logo).astype(int) - np.asarray(bg).astype(int)
    ys, xs = np.nonzero(np.abs(diff).sum(axis=2) > 30)
    pad = 20
    logo = logo.crop((xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad))
    logo.thumbnail((600, 600), Image.LANCZOS)
    logo.save(OUT / "logo.png", optimize=True)


if __name__ == "__main__":
    main()
