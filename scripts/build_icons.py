# -*- coding: utf-8 -*-
"""Rendert icon.svg in alle gebrauchten Groessen.

    pip install pymupdf pillow
    python scripts/build_icons.py

icon.svg ist die einzige Quelle - PNGs und favicon.ico entstehen daraus, damit
die Groessen nicht auseinanderlaufen. Nur noetig, wenn sich icon.svg aendert;
die fertigen Dateien liegen im Repo.

Achtung: Der Renderer (MuPDF) kann keine SVG-Verlaeufe, er malt sie schwarz.
icon.svg ist deshalb bewusst einfarbig - sonst saehen Datei und PNG anders aus.
"""
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SVG = REPO / "icon.svg"

# apple-touch-icon: iOS-Homescreen, 192/512: Android bzw. Web-App-Manifest
PNGS = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}
ICO_SIZES = [16, 32, 48]
QUELLE = 1024  # einmal gross rendern, dann sauber runterskalieren


def render(px):
    doc = fitz.open(str(SVG))
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(px / 512, px / 512), alpha=True)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")


def pruefe_svg():
    """Browser parsen SVG streng als XML und zeigen bei einem Fehler gar nichts.

    MuPDF ist da nachsichtiger - ohne diese Pruefung baut das Script also
    froehlich PNGs aus einer Datei, die im Browser tot ist (schon passiert:
    zwei Bindestriche in einem Kommentar sind in XML verboten).
    """
    try:
        ET.parse(SVG)
    except ET.ParseError as exc:
        sys.exit(f"icon.svg ist kein gueltiges XML - der Browser wuerde sie "
                 f"nicht anzeigen:\n  {exc}")


def main():
    pruefe_svg()
    gross = render(QUELLE)

    # iOS legt hinter apple-touch-icon Schwarz, wenn Transparenz da ist, und
    # rundet die Ecken selbst -> dafuer eine Fassung ohne Alpha auf Blau.
    flach = Image.new("RGBA", gross.size, (43, 87, 199, 255))
    flach.alpha_composite(gross)

    for name, size in PNGS.items():
        quelle = flach if name == "apple-touch-icon.png" else gross
        quelle.resize((size, size), Image.LANCZOS).save(REPO / name, optimize=True)
        print(f"  {name:<22} {size}x{size}")

    ico = [gross.resize((s, s), Image.LANCZOS) for s in ICO_SIZES]
    ico[0].save(REPO / "favicon.ico", format="ICO",
                sizes=[(s, s) for s in ICO_SIZES], append_images=ico[1:])
    print(f"  {'favicon.ico':<22} {'/'.join(map(str, ICO_SIZES))}")


if __name__ == "__main__":
    main()
