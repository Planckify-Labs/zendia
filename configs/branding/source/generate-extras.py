# Builds the wordmarks, private, document and installer art from mark.svg.
# Run: python generate-extras.py <dir with mark.svg> <out dir>   (needs fonttools)
import re, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
S, OUT = sys.argv[1], sys.argv[2]
DARK = ["#fca7ea","#c3e88d","#c099ff","#82aaff","#ffc777","#4fd6be"]
LIGHT = ["#b0307f","#476628","#7340cc","#2160c4","#7a5c14","#0b7461"]
inner = re.sub(r'^<svg[^>]*>|</svg>$', '', open(f"{S}/mark.svg").read())
def recolor(pal):
    s = inner
    for a, b in zip(DARK, pal): s = s.replace(a, "@" + b[1:])
    return s.replace("@", "#")
def private_mark():  # every mode in one purple, NORMAL's cursor still pink
    s = inner
    for c in DARK[1:]: s = s.replace(f'stroke="{c}"', 'stroke="#c099ff"')
    return s.replace('stroke="#fca7ea" stroke-width="86"', 'stroke="#c099ff" stroke-width="86"')
def place(content, x, y, size):  # mark viewBox is 150..874 (724 wide)
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="150 150 724 724">{content}</svg>'

font = TTFont("/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf")
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
def text_path(text, x, baseline, size):
    scale, pen = size / upm, SVGPathPen(gs)
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        x += gs[g].width * scale
    return pen.getCommands(), x

files = {}
# Wordmarks: "zendia" in JetBrains Mono Bold, outlined, keeping each file's fill rule.
d, w = text_path("zendia", 2, 43, 40)
files["about-wordmark.svg"] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(w+2)} 56"><path fill="#fff" d="{d}"/></svg>'
files["firefox-wordmark.svg"] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(w+2)} 56"><path style="fill:context-fill #1a1b26" d="{d}"/></svg>'
# Private: the ring with its modes gone quiet in one purple, the mascot still pink, on a deep purple tile.
files["private.svg"] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="232" fill="#2d2150"/>{place(private_mark(), 166, 166, 692)}</svg>'
# Documents: a page in the light palette with the mark on it; the PDF one gets a red band.
page = ('<path d="M176 40h480l192 192v712a40 40 0 0 1-40 40H176a40 40 0 0 1-40-40V80a40 40 0 0 1 40-40z" fill="#f5f6fa" stroke="#c4c8da" stroke-width="16"/>'
        '<path d="M656 40v152a40 40 0 0 0 40 40h152z" fill="#e6e8f0" stroke="#c4c8da" stroke-width="16" stroke-linejoin="round"/>')
files["document.svg"] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{page}{place(recolor(LIGHT), 252, 360, 480)}</svg>'
pd, pw = text_path("PDF", 0, 0, 150)
files["document_pdf.svg"] = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{page}{place(recolor(LIGHT), 302, 270, 380)}'
    f'<rect x="96" y="690" width="600" height="210" rx="28" fill="#c8174c"/><path fill="#fff" transform="translate({396 - pw/2} 850)" d="{pd}"/></svg>')
# The installer banner: mark and name side by side on the statusline's night.
ld, lw = text_path("zendia", 0, 0, 52)
files["MacOSInstaller.svg"] = (f'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="130" viewBox="0 0 320 130"><rect width="320" height="130" fill="#1a1b26"/>'
    f'{place(inner, 30, 25, 80)}<path fill="#c8d3f5" transform="translate(128 84)" d="{ld}"/></svg>')
for n, s in files.items(): open(f"{OUT}/{n}", "w").write(s)
