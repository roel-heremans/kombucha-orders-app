"""Generate the self-signup QR code.  Run from repo root: python3 qr/make_qr.py"""
from pathlib import Path
import segno
from PIL import Image

URL = "https://roel-heremans.github.io/kombucha-orders-app/?signup"
HERE = Path(__file__).resolve().parent
ICON = HERE.parent / "icons" / "icon-512.png"
GREEN = "#1c392d"


def main():
    qr = segno.make(URL, error="h")  # 30% error correction leaves room for the centre logo
    qr.save(HERE / "signup-qr.svg", scale=10, border=4, dark=GREEN)  # vector, no logo
    png = HERE / "signup-qr.png"
    qr.save(png, scale=24, border=4, dark=GREEN)
    img = Image.open(png).convert("RGB")
    side = img.width // 5  # logo covers ~4% of the area, well within H-level correction
    logo = Image.open(ICON).convert("RGB").resize((side, side), Image.LANCZOS)
    pad = side // 10
    box = Image.new("RGB", (side + 2 * pad, side + 2 * pad), "white")
    box.paste(logo, (pad, pad))
    img.paste(box, ((img.width - box.width) // 2, (img.height - box.height) // 2))
    img.save(png, optimize=True)


if __name__ == "__main__":
    main()
