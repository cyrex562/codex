#!/usr/bin/env python3
"""Generate the Librarium logo/icon set from a single vector definition.

Motif: an open book whose pages resolve into a small knowledge graph.
Monochrome light mark on a neutral rounded-square gradient tile.
Renders a high-res master via supersampling, then derives every needed size.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

SS = 4  # supersample factor for smooth edges

# ── palette ──────────────────────────────────────────────────────────────────
TILE_TOP = (43, 49, 60)      # #2b313c  (top-left, lighter charcoal)
TILE_BOT = (13, 15, 19)      # #0d0f13  (bottom-right, near black)
MARK     = (238, 241, 246)   # #eef1f6  (light, monochrome mark)
MARK_DIM = (238, 241, 246, 235)

# normalized geometry (0..1 in tile space) --------------------------------------
CORNER_R = 0.225

# open book as ONE silhouette: both edges dip to a central fold so the two pages
# keep even height and read as a book (not an hourglass). Left page = outer-top,
# center-top, center-bottom, outer-bottom; right page mirrors it.
SPINE = 0.5
BOOK = [
    (0.170, 0.575),   # left outer top
    (0.500, 0.638),   # center top (fold)
    (0.830, 0.575),   # right outer top
    (0.830, 0.700),   # right outer bottom
    (0.500, 0.755),   # center bottom (fold)
    (0.170, 0.700),   # left outer bottom
]

# knowledge graph growing out of the book
N_APEX  = (0.50, 0.225)
N_LEFT  = (0.265, 0.365)
N_RIGHT = (0.735, 0.365)
N_ROOT  = (0.50, 0.632)           # sits at the top of the spine fold
P_LEFT  = (0.330, 0.615)          # left edge plugs into the page
P_RIGHT = (0.670, 0.615)          # right edge plugs into the page

EDGES = [
    (N_ROOT, N_APEX),
    (N_APEX, N_LEFT),
    (N_APEX, N_RIGHT),
    (N_LEFT, P_LEFT),
    (N_RIGHT, P_RIGHT),
]
NODES = [
    (N_APEX, 0.055),
    (N_LEFT, 0.043),
    (N_RIGHT, 0.043),
    (N_ROOT, 0.024),
]
EDGE_W = 0.021
SPINE_W = 0.013  # dark spine fold line


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient_tile(size):
    """Neutral diagonal gradient, top-left -> bottom-right."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    maxd = 2 * (size - 1)
    for y in range(size):
        for x in range(size):
            t = (x + y) / maxd
            px[x, y] = lerp(TILE_TOP, TILE_BOT, t)
    return img


def rounded_mask(size, radius_frac):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def draw_mark(draw, size, color=MARK):
    def P(pt):
        return (pt[0] * size, pt[1] * size)

    # graph edges first (round caps via end circles); ends inside the book/nodes
    ew = max(1, int(EDGE_W * size))
    hw = ew / 2
    for a, b in EDGES:
        draw.line([P(a), P(b)], fill=color, width=ew)
        for pt in (a, b):
            x, y = P(pt)
            draw.ellipse([x - hw, y - hw, x + hw, y + hw], fill=color)

    # book silhouette on top so the lower edges plug in cleanly
    draw.polygon([P(p) for p in BOOK], fill=color)

    # spine fold line (subtle dark) down the center of the book
    sw = max(1, int(SPINE_W * size))
    draw.line([P((SPINE, 0.642)), P((SPINE, 0.752))],
              fill=lerp(TILE_TOP, TILE_BOT, 0.55), width=sw)

    # nodes on top for clean joins
    for (cx, cy), r in NODES:
        rr = r * size
        x, y = cx * size, cy * size
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)


def build_master(px):
    """Full icon (tile + mark) at px, rounded + transparent outside."""
    s = px * SS
    tile = gradient_tile(s).convert("RGBA")
    d = ImageDraw.Draw(tile)
    draw_mark(d, s)
    tile.putalpha(rounded_mask(s, CORNER_R))
    return tile.resize((px, px), Image.LANCZOS)


def build_mark_only(px, color=MARK):
    """Just the monochrome mark on transparent (for inline logo use)."""
    s = px * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # draw book/graph in a single flat color; spine line uses a translucent hole
    def P(pt):
        return (pt[0] * s, pt[1] * s)
    ew = max(1, int(EDGE_W * s))
    hw = ew / 2
    for a, b in EDGES:
        d.line([P(a), P(b)], fill=color, width=ew)
        for pt in (a, b):
            x, y = P(pt)
            d.ellipse([x - hw, y - hw, x + hw, y + hw], fill=color)
    d.polygon([P(p) for p in BOOK], fill=color)
    for (cx, cy), r in NODES:
        rr = r * s
        x, y = cx * s, cy * s
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)
    return img.resize((px, px), Image.LANCZOS)


# ── render master + derivatives ────────────────────────────────────────────────
master = build_master(1024)
master.save(os.path.join(OUT, "icon-1024.png"))
for sz in (512, 256, 128, 64, 32):
    master.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, f"icon-{sz}x{sz}.png"))

# ICO (multi-res) from crisp per-size renders
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
ico_imgs = [build_master(s) for s in ico_sizes]
ico_imgs[-1].save(os.path.join(OUT, "icon.ico"), format="ICO",
                  sizes=[(s, s) for s in ico_sizes])

# standalone monochrome mark (light + dark)
build_mark_only(512, MARK).save(os.path.join(OUT, "mark-light-512.png"))
build_mark_only(512, (26, 26, 26, 255)).save(os.path.join(OUT, "mark-dark-512.png"))


def build_tray(px, color):
    """Simplified mark for tiny tray sizes: open book + 3 nodes + short stems,
    in a solid status color on transparent. Detail is dropped so it reads at
    ~16-22px; the whole glyph is enlarged to fill the tray cell."""
    s = px * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # enlarged, vertically-centered geometry (normalized, own layout)
    book = [(0.10, 0.52), (0.50, 0.60), (0.90, 0.52),
            (0.90, 0.70), (0.50, 0.80), (0.10, 0.70)]
    nodes = [((0.50, 0.16), 0.10), ((0.20, 0.34), 0.075), ((0.80, 0.34), 0.075)]
    stems = [((0.50, 0.60), (0.50, 0.16)),
             ((0.50, 0.16), (0.20, 0.34)),
             ((0.50, 0.16), (0.80, 0.34)),
             ((0.20, 0.34), (0.30, 0.565)),
             ((0.80, 0.34), (0.70, 0.565))]
    def P(pt):
        return (pt[0] * s, pt[1] * s)
    ew = max(1, int(0.05 * s))
    hw = ew / 2
    for a, b in stems:
        d.line([P(a), P(b)], fill=color, width=ew)
        for pt in (a, b):
            x, y = P(pt)
            d.ellipse([x - hw, y - hw, x + hw, y + hw], fill=color)
    d.polygon([P(p) for p in book], fill=color)
    for (cx, cy), r in nodes:
        rr = r * s
        x, y = cx * s, cy * s
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)
    return img.resize((px, px), Image.LANCZOS)


TRAY = {"green": (63, 185, 80), "red": (248, 81, 73), "yellow": (210, 153, 34)}
for name, col in TRAY.items():
    build_tray(32, col).save(os.path.join(OUT, f"tray-{name}.png"))

# contact sheet for review
sheet = Image.new("RGBA", (1024 + 32*6 + 80, 1024 + 40), (28, 30, 34, 255))
sheet.paste(master, (16, 20), master)
x = 1024 + 32
for sz in (256, 128, 64, 32, 16):
    im = master.resize((sz, sz), Image.LANCZOS)
    sheet.paste(im, (x, 20), im)
    x_light = x
    x += 8
# also show mark-only on light strip
light = Image.new("RGBA", (300, 300), (245, 246, 248, 255))
mk = build_mark_only(240, (26,26,26,255))
light.paste(mk, (30, 30), mk)
sheet.paste(light, (1024 + 32, 320))
sheet.convert("RGB").save(os.path.join(OUT, "_contact_sheet.png"))

print("wrote:", sorted(os.listdir(OUT)))
