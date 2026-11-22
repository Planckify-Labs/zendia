# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Zendia's logo, its mode editions and every branding master, from one geometry.

The logo is six soft cells, one per vim mode in its color, packed with hairline
gaps around the mascot: a rounded head with its bolt antenna and two open eyes.
NORMAL's cell is the largest, at the top. In each mode edition that mode's cell
grows into the lead, the mascot takes the mode's color and its antenna pose,
its eyes show what the mode is for, and the leading cell carries the mode's
letter, built from the same rounded cells.

Writes the SVG masters next to this file (export.sh turns them into the files
in configs/branding), the six editions in modes/, and the drawing data that
src/zen/zendia/ui/ZendiaMascot.sys.mjs morphs between modes.

Needs shapely and fonttools:  python3 generate.py
"""

import json
import math
import re
from pathlib import Path

import shapely
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from shapely import affinity
from shapely.geometry import LineString, MultiPoint, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union, voronoi_diagram

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MASCOT_MODULE = REPO / "src/zen/zendia/ui/ZendiaMascot.sys.mjs"
FONT = "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf"

NIGHT, TWILIGHT, SNOW = "#1a1b26", "#283457", "#c8d3f5"
KEYS = "nivetl"
NAMES = dict(n="NORMAL", i="INSERT", v="VISUAL", e="EXPLORER", t="TOOLBAR", l="LIBRARY")
DARK = dict(n="#fca7ea", i="#c3e88d", v="#c099ff", e="#82aaff", t="#ffc777", l="#4fd6be")
LIGHT = dict(n="#b0307f", i="#476628", v="#7340cc", e="#2160c4", t="#7a5c14", l="#0b7461")

# ---------------------------------------------------------------- the mascot

# Its head, the six-cornered visor of the original mascot, rounded deep.
HEAD = Polygon([(396.1, 493.7), (591.3, 463.2), (646.2, 512.0), (621.8, 609.6), (432.7, 627.9), (377.8, 560.8)])
HEAD = HEAD.buffer(35, 64, join_style=1)
HEAD = HEAD.buffer(-80, join_style=1).buffer(80, 96, join_style=1)
CX, CY = HEAD.centroid.x, HEAD.centroid.y

# Its bolt antenna, drawn from its foot in the mascot's own 60-unit box.
BOLT = [(0, 1), (4.5, -9), (1, -8.4), (7, -19), (10.5, -18), (5.5, -7.4), (9.5, -8.2), (3.4, 2.4)]


def bolt(x, y, degrees, scale):
    a = math.radians(degrees)
    c, s = math.cos(a) * scale, math.sin(a) * scale
    pts = [(x + px * c - py * s, y + px * s + py * c) for px, py in BOLT]
    return Polygon([(512 + (px - 29) * 6.1, 512 + (py - 23) * 6.1) for px, py in pts]).buffer(22, 48, join_style=1)


# Each mode's antenna: upright at rest, tilted while typing, split in two while
# selecting, pointing to the tabs in the explorer, perked up and tipped back at
# the toolbar, drooping over the page in the library.
ANTENNA = dict(
    n=[(41, 16, 0, 1)],
    i=[(39, 16, 38, 0.85)],
    v=[(40, 16, -16, 0.95), (44, 18, 34, 0.8)],
    e=[(38, 16, -68, 1)],
    t=[(41, 16, -22, 1.15)],
    l=[(45, 18, 58, 1.08)],
)

# Each mode's eyes, left then right: (x0, y0, x1, y1, width), round-capped.
EYES = dict(
    n=[(474, 530, 474, 568, 44), (558, 518, 558, 556, 44)],  # two open eyes
    i=[(476, 538, 476, 566, 44), (560, 504, 560, 572, 16)],  # one eye is the text caret
    v=[(472, 549, 472, 549, 62), (556, 537, 556, 537, 62)],  # wide and round
    e=[(458, 532, 458, 566, 44), (542, 520, 542, 554, 44)],  # glancing left, to the tabs
    t=[(478, 518, 478, 550, 44), (562, 506, 562, 538, 44)],  # glancing up, to the toolbar
    l=[(474, 552, 474, 566, 44), (558, 540, 558, 554, 44)],  # lowered, reading
)


def eye_shape(x0, y0, x1, y1, w):
    if (x0, y0) == (x1, y1):
        return Point(x0, y0).buffer(w / 2, 48)
    return LineString([(x0, y0), (x1, y1)]).buffer(w / 2, 48)


def mascot(key):
    return unary_union([HEAD] + [bolt(*a) for a in ANTENNA[key]])


# ------------------------------------------------------------------ the cells

# (angle, seed distance, bulge distance, bulge radius) for each mode's cell,
# NORMAL first at the top and largest, the rest clockwise and uneven.
CELLS = [(-96, 305, 300, 208), (-36, 295, 290, 182), (22, 278, 272, 152), (80, 296, 292, 190), (141, 282, 276, 158), (203, 300, 295, 192)]
LEAD = (318, 318, 228)  # the leading cell in a mode edition
REST_NORMAL = (288, 280, 168)  # NORMAL's cell when another mode leads
GAP, CORNER = 10, 44


def pack(cells, centre):
    """The six cells: Voronoi cells of their seeds, each cut by its own round bulge,
    kept a hairline away from the mascot and from each other, corners rounded."""
    seeds = [(CX + d * math.cos(math.radians(a)), CY + d * math.sin(math.radians(a))) for a, d, _, _ in cells]
    frame = Polygon([(-3000, -3000), (4000, -3000), (4000, 4000), (-3000, 4000)])
    vor = list(voronoi_diagram(MultiPoint(seeds), envelope=frame).geoms)
    keep_out = centre.buffer(GAP, 64, join_style=1)
    out = []
    for (a, d, bd, br), s in zip(cells, seeds):
        cell = min(vor, key=lambda c: c.distance(Point(s)))
        bulge = Point(CX + bd * math.cos(math.radians(a)), CY + bd * math.sin(math.radians(a))).buffer(br, 160)
        p = cell.intersection(bulge).difference(keep_out).buffer(-GAP / 2, join_style=1)
        if p.geom_type == "MultiPolygon":
            p = max(p.geoms, key=lambda q: q.area)
        out.append(p.buffer(-CORNER, join_style=1).buffer(CORNER, 64, join_style=1))
    return out


def edition_cells(key):
    m = KEYS.index(key)
    cells = []
    for j, (a, d, bd, br) in enumerate(CELLS):
        if j == m:
            cells.append((a, *LEAD))
        elif j == 0:
            cells.append((a, *REST_NORMAL))
        else:
            cells.append((a, d, bd, br))
    return cells


# ---------------------------------------------------------------- the letters

def flatten(d):
    toks = re.findall(r"[MLHVQ]|-?\d+(?:\.\d+)?", d)
    pts, x, y, i, cmd = [], 0.0, 0.0, 0, None
    while i < len(toks):
        if toks[i] in "MLHVQ":
            cmd = toks[i]
            i += 1
            continue
        if cmd in "ML":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
        elif cmd == "H":
            x = float(toks[i])
            i += 1
        elif cmd == "V":
            y = float(toks[i])
            i += 1
        elif cmd == "Q":
            c1, c2, x1, y1 = (float(v) for v in toks[i:i + 4])
            i += 4
            for k in range(1, 16):
                t = k / 16
                pts.append(((1 - t) ** 2 * x + 2 * (1 - t) * t * c1 + t * t * x1, (1 - t) ** 2 * y + 2 * (1 - t) * t * c2 + t * t * y1))
            x, y = x1, y1
        pts.append((x, y))
    return pts


def stroke(d, w):
    pts = flatten(d)
    if len(set(pts)) <= 2 and math.dist(pts[0], pts[-1]) < 0.01:
        return Point(pts[0]).buffer(w * 0.62, 32)  # a dot, a little fuller
    return LineString(pts).buffer(w / 2, 32)


def pieces(groups, w, gap, rnd):
    """Strokes grouped into pieces; each later piece gives way to the earlier ones."""
    out, taken = [], None
    for group in groups:
        g = unary_union([stroke(d, w) for d in group])
        if taken is not None:
            g = g.difference(taken.buffer(gap, 32))
            if g.geom_type == "MultiPolygon":
                g = max(g.geoms, key=lambda q: q.area)
        taken = g if taken is None else taken.union(g)
        out.append(g.buffer(-rnd, 32).buffer(rnd, 32))
    return unary_union(out)


def shared(a, b, w=0.4, gap=0.08, rnd=0.12):
    """Two strokes that each give up half the gap to the other."""
    u, l = stroke(a, w), stroke(b, w)
    u2, l2 = u.difference(l.buffer(gap / 2, 32)), l.difference(u.buffer(gap / 2, 32))
    u3 = u2.difference(l2.buffer(gap / 2, 32))
    l3 = l2.difference(u3.buffer(gap / 2, 32))
    return unary_union([p.buffer(-rnd, 32).buffer(rnd, 64) for p in (u3, l3)])


# Each in the style picked for it, in a box one x-height tall:
#   n  chunky: legs and arch as three plump cells
#   i  a thick stem and a floating dot
#   v  both arms as one body, the tip of the second floating off
#   e  the bar joined to the top arc, the lower arc on its own
#   t  two interlocking hooks sharing the gap between them
#   l  a tall stem and a rounded foot
LETTERS = dict(
    n=lambda: pieces([["M0 1V0.5"], ["M0 0.4Q0 0 0.38 0Q0.76 0 0.76 0.4"], ["M0.76 0.5V1"]], 0.44, 0.09, 0.1),
    i=lambda: pieces([["M0 0.2V1"], ["M0 -0.36L0.001 -0.36"]], 0.4, 0.08, 0.1),
    v=lambda: pieces([["M0 0L0.34 0.94L0.5 0.52"], ["M0.6 0.24L0.7 0"]], 0.4, 0.08, 0.1),
    e=lambda: pieces([["M0.04 0.5H0.84Q0.8 0 0.42 0Q0 0 0 0.5"], ["M0 0.56Q0 0.98 0.42 0.98Q0.6 0.98 0.7 0.9"]], 0.34, 0.08, 0.07),
    t=lambda: shared("M0.26 -0.4V-0.1Q0.26 0.24 -0.12 0.24", "M0.74 0.24Q0.32 0.24 0.32 0.6V0.74Q0.32 1.0 0.6 1.0"),
    l=lambda: pieces([["M0 -0.44V0.62"], ["M0.02 0.9Q0.04 1 0.28 1"]], 0.4, 0.08, 0.1),
)


def letter_on(key, cell, angle):
    """The letter placed at the roomiest point of its cell, sized to it, leaning a little with it."""
    circle = shapely.maximum_inscribed_circle(cell)
    (x, y), r = circle.coords[0], circle.length
    g = LETTERS[key]()
    minx, miny, maxx, maxy = g.bounds
    lean = math.sin(math.radians(angle + 90)) * 9
    return dict(shape=g, x=x, y=y, size=r * 0.84, lean=lean, mx=(minx + maxx) / 2, my=(miny + maxy) / 2)


def place_letter(L):
    g = affinity.translate(L["shape"], -L["mx"], -L["my"])
    g = affinity.scale(g, L["size"], L["size"], origin=(0, 0))
    g = affinity.rotate(g, L["lean"], origin=(0, 0))
    return affinity.translate(g, L["x"], L["y"])


# ---------------------------------------------------------- the whole drawing

TILT = -3  # the whole cluster leans a touch, as if set down by hand
FIT = 0.8  # of the 1024 tile


def frame_for(shapes):
    minx, miny, maxx, maxy = unary_union(shapes).bounds
    mx, my = (minx + maxx) / 2, (miny + maxy) / 2
    scale = FIT * 1024 / max(maxx - minx, maxy - miny)

    def to_tile(g):
        g = affinity.translate(g, -mx, -my)
        g = affinity.scale(g, scale, scale, origin=(0, 0))
        g = affinity.rotate(g, TILT, origin=(0, 0))
        return affinity.translate(g, 512, 512)

    return to_tile, scale


def logo_parts():
    """The logo: the cells at rest, NORMAL leading, the mascot upright with two open eyes."""
    centre = mascot("n")
    cells = pack(CELLS, centre)
    to_tile, _ = frame_for(cells + [centre])
    head = centre.difference(unary_union([eye_shape(*e) for e in EYES["n"]]))
    return [to_tile(c) for c in cells], to_tile(head)


def edition_parts():
    """The six editions, in one shared frame so nothing jumps between them."""
    raw = {}
    for key in KEYS:
        centre = mascot(key)
        cells = pack(edition_cells(key), centre)
        raw[key] = (centre, cells)
    to_tile, scale = frame_for([g for c, cs in raw.values() for g in [c] + cs])
    out = {}
    for key, (centre, cells) in raw.items():
        m = KEYS.index(key)
        letter = letter_on(key, cells[m], CELLS[m][0])
        out[key] = dict(
            centre=to_tile(centre),
            cells=[to_tile(c) for c in cells],
            eyes=[(to_tile(Point(x0, y0)), to_tile(Point(x1, y1)), w * scale) for x0, y0, x1, y1, w in EYES[key]],
            letter=dict(letter, x=to_tile(Point(letter["x"], letter["y"])).x, y=to_tile(Point(letter["x"], letter["y"])).y,
                        size=letter["size"] * scale, lean=letter["lean"] + TILT),
        )
    return out


# --------------------------------------------------------------------- output

def d_of(g, nd=1):
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = ""
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            out += "M" + "L".join(f"{x:.{nd}f} {y:.{nd}f}" for x, y in list(ring.coords)[:-1]) + "Z"
    return out


def svg(body, view="0 0 1024 1024", attrs=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{attrs}>{body}</svg>\n'


def tile(color):
    return f'<rect width="1024" height="1024" rx="232" fill="{color}"/>'


def logo_body(cells, head, pal, head_color=None):
    body = "".join(f'<path d="{d_of(c)}" fill="{pal[k]}"/>' for c, k in zip(cells, KEYS))
    return body + f'<path d="{d_of(head)}" fill="{head_color or pal["n"]}" fill-rule="evenodd"/>'


def bounds_view(shapes, pad=0):
    minx, miny, maxx, maxy = unary_union(shapes).bounds
    return f"{minx - pad:.0f} {miny - pad:.0f} {maxx - minx + 2 * pad:.0f} {maxy - miny + 2 * pad:.0f}"


def text_path(text, size):
    font = TTFont(FONT)
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    pen, x = SVGPathPen(gs), 0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (size / upm, 0, 0, -size / upm, x, 0)))
        x += gs[g].width * size / upm
    return pen.getCommands(), x


def write_masters():
    cells, head = logo_parts()
    shapes = cells + [head]
    masters = {}
    masters["logo.svg"] = svg(tile(NIGHT) + logo_body(cells, head, DARK))
    masters["logo-twilight.svg"] = svg(tile(TWILIGHT) + logo_body(cells, head, DARK))
    inset = '<g transform="translate(100 100) scale(0.8047)">{}</g>'
    masters["logo-mac.svg"] = svg(inset.format(tile(NIGHT) + logo_body(cells, head, DARK)))
    masters["logo-mac-twilight.svg"] = svg(inset.format(tile(TWILIGHT) + logo_body(cells, head, DARK)))
    view = bounds_view(shapes, 8)
    masters["mark.svg"] = svg(logo_body(cells, head, DARK), view)
    # The about dialog shows it on Zen's light or dark surface, so it follows the color scheme.
    css = lambda pal: "".join(f".c{k}{{fill:{pal[k]}}}" for k in KEYS)
    about = f"<style>{css(DARK)}@media (prefers-color-scheme: light){{{css(LIGHT)}}}</style>"
    about += "".join(f'<path class="c{k}" d="{d_of(c)}"/>' for c, k in zip(cells, KEYS))
    about += f'<path class="cn" d="{d_of(head)}" fill-rule="evenodd"/>'
    masters["about-logo.svg"] = svg(about, view)
    # Private browsing: every cell in one quiet purple, the mascot still itself.
    quiet = {k: "#c099ff" for k in KEYS}
    masters["private.svg"] = svg(tile("#2d2150") + logo_body(cells, head, quiet, DARK["n"]))
    # Documents: a page with the mark on it in the light theme's colors; the PDF one with a label.
    page = ('<path d="M176 40h480l192 192v712a40 40 0 0 1-40 40H176a40 40 0 0 1-40-40V80a40 40 0 0 1 40-40z" fill="#f5f6fa" stroke="#c4c8da" stroke-width="16"/>'
            '<path d="M656 40v152a40 40 0 0 0 40 40h152z" fill="#e6e8f0" stroke="#c4c8da" stroke-width="16" stroke-linejoin="round"/>')
    mark_at = lambda x, y, s: f'<svg x="{x}" y="{y}" width="{s}" height="{s}" viewBox="{view}">{logo_body(cells, head, LIGHT)}</svg>'
    masters["document.svg"] = svg(page + mark_at(252, 360, 480))
    pd, pw = text_path("PDF", 150)
    masters["document_pdf.svg"] = svg(page + mark_at(302, 270, 380) + f'<rect x="96" y="690" width="600" height="210" rx="28" fill="#c8174c"/><path fill="#fff" transform="translate({396 - pw / 2:.1f} 850)" d="{pd}"/>')
    # The macOS installer's banner: the mark and the name.
    ld, _ = text_path("zendia", 52)
    masters["MacOSInstaller.svg"] = svg(f'<rect width="320" height="130" fill="{NIGHT}"/><svg x="26" y="21" width="88" height="88" viewBox="{view}">{logo_body(cells, head, DARK)}</svg><path fill="{SNOW}" transform="translate(128 84)" d="{ld}"/>',
                                        "0 0 320 130", ' width="320" height="130"')
    for channel, bg in (("release", NIGHT), ("twilight", TWILIGHT)):
        masters[f"visual-{channel}.svg"] = svg(f'<rect width="1042" height="1046" fill="{bg}"/><svg x="231" y="233" width="580" height="580" viewBox="{view}">{logo_body(cells, head, DARK)}</svg>', "0 0 1042 1046")
        masters[f"watermark-{channel}.svg"] = svg(f'<rect width="164" height="314" fill="{bg}"/><svg x="-34" y="-34" width="160" height="160" viewBox="{view}">{logo_body(cells, head, DARK)}</svg>'
                                                  f'<text x="14" y="296" font-family="JetBrainsMono NF" font-weight="700" font-size="20" fill="{SNOW}">zendia</text>', "0 0 164 314")
    # The Windows installer: the strip across the top of its pages (Firefox's
    # globe otherwise), its right-to-left twin, the online installer's
    # background, and the logos of the Windows package.
    mark = lambda x, y, size: f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{view}">{logo_body(cells, head, DARK)}</svg>'
    # The header strip is white, so it takes the light theme's deeper colors.
    light_mark = lambda x, y, size: f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{view}">{logo_body(cells, head, LIGHT)}</svg>'
    masters["installer-header.svg"] = svg(f'<rect width="150" height="57" fill="#ffffff"/>{light_mark(97, 4, 49)}', "0 0 150 57")
    masters["installer-header-rtl.svg"] = svg(f'<rect width="150" height="57" fill="#ffffff"/>{light_mark(4, 4, 49)}', "0 0 150 57")
    masters["installer-background.svg"] = svg(f'<rect width="1344" height="822" fill="{NIGHT}"/>{mark(502, 90, 340)}', "0 0 1344 822")
    masters["mark-padded.svg"] = svg(mark(64, 64, 896))
    masters["wide-tile.svg"] = svg(mark(170, 10, 280), "0 0 620 300")
    for name, text in masters.items():
        (HERE / name).write_text(text)
    return masters


def write_editions(eds):
    (HERE / "modes").mkdir(exist_ok=True)
    for key, ed in eds.items():
        body = "".join(f'<path d="{d_of(c)}" fill="{DARK[k]}"/>' for c, k in zip(ed["cells"], KEYS))
        body += f'<path d="{d_of(ed["centre"])}" fill="{DARK[key]}"/>'
        for a, b, w in ed["eyes"]:
            x1 = b.x + (0.01 if (a.x, a.y) == (b.x, b.y) else 0)
            body += f'<path d="M{a.x:.1f} {a.y:.1f}L{x1:.1f} {b.y:.1f}" stroke="{NIGHT}" stroke-width="{w:.1f}" stroke-linecap="round"/>'
        body += f'<path d="{d_of(place_letter(ed["letter"]))}" fill="{NIGHT}" fill-rule="evenodd"/>'
        (HERE / "modes" / f"{NAMES[key].lower()}.svg").write_text(svg(tile(NIGHT) + body))


def resample(poly, n, start_dir=None):
    """A closed outline as n evenly spaced points, counterclockwise, starting at a
    fixed place so that the same outline in two modes lines up point for point."""
    poly = orient(poly if poly.geom_type == "Polygon" else max(poly.geoms, key=lambda q: q.area), 1.0)
    ring = list(poly.exterior.coords)[:-1]
    if start_dir is None:  # the lowest point, for the head
        start = max(range(len(ring)), key=lambda i: ring[i][1] - abs(ring[i][0] - 512) * 0.2)
    else:
        dx, dy = start_dir
        start = max(range(len(ring)), key=lambda i: (ring[i][0] - 512) * dx + (ring[i][1] - 512) * dy)
    ring = ring[start:] + ring[:start] + [ring[start]]
    seg = [math.dist(ring[i], ring[i + 1]) for i in range(len(ring) - 1)]
    total, out, i, acc = sum(seg), [], 0, 0.0
    for k in range(n):
        at = total * k / n
        while acc + seg[i] < at:
            acc += seg[i]
            i += 1
        t = (at - acc) / seg[i] if seg[i] else 0
        out += [round(ring[i][0] + (ring[i + 1][0] - ring[i][0]) * t), round(ring[i][1] + (ring[i + 1][1] - ring[i][1]) * t)]
    return out


def mascot_data(eds):
    """The editions as the mascot module plays them: outlines resampled so they
    morph point for point, eyes as strokes, letters as small filled paths."""
    modes = {}
    for key, ed in eds.items():
        cells = []
        for j, c in enumerate(ed["cells"]):
            a = math.radians(CELLS[j][0] + TILT)
            cells.append(resample(c, 72, (math.cos(a), math.sin(a))))
        L = ed["letter"]
        modes[key] = dict(
            cells=cells,
            head=resample(ed["centre"], 120),
            eyes=[[round(a.x, 1), round(a.y, 1), round(b.x, 1), round(b.y, 1), round(w, 1)] for a, b, w in ed["eyes"]],
            # Simplified to a fraction of a pixel at any size it is shown.
            letter=dict(d=d_of(affinity.translate(L["shape"], -L["mx"], -L["my"]).simplify(0.004), 3),
                        x=round(L["x"], 1), y=round(L["y"], 1), size=round(L["size"], 1), lean=round(L["lean"], 1)),
        )
    allpts = [pt for ed in eds.values() for g in ed["cells"] + [ed["centre"]] for pt in g.exterior.coords]
    xs, ys = [p[0] for p in allpts], [p[1] for p in allpts]
    pad = 24  # room for the ink edge
    view = dict(x=round(min(xs) - pad), y=round(min(ys) - pad), width=round(max(xs) - min(xs) + 2 * pad), height=round(max(ys) - min(ys) + 2 * pad))
    return modes, view


def write_module_data(modes, view):
    text = MASCOT_MODULE.read_text()
    begin, end = "// BEGIN GENERATED by tools/branding/generate.py\n", "// END GENERATED\n"
    box = ", ".join(f"{k}: {v}" for k, v in view.items())
    block = (begin + "// The part of the 1024 grid the drawings fill, with room for the ink edge.\n"
             + f"export const MASCOT_VIEWBOX = {{ {box} }};\n"
             + "// The six drawings, as data; prettier leaves them on one line.\n// prettier-ignore\n"
             + f"const DRAWINGS = {json.dumps(modes, separators=(',', ':'))};\n" + end)
    a, b = text.index(begin), text.index(end) + len(end)
    MASCOT_MODULE.write_text(text[:a] + block + text[b:])


def main():
    write_masters()
    eds = edition_parts()
    write_editions(eds)
    modes, view = mascot_data(eds)
    write_module_data(modes, view)
    print("wrote the masters, modes/ and the mascot's drawings")


if __name__ == "__main__":
    main()
