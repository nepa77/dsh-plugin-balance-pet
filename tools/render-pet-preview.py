"""Render the pet, its menu and the sidebar entry exactly as the browser draws them.

This is a standalone copy of the maintainer's preview renderer, shipped so the visual claims
in README.md and docs/previews/ can be reproduced (and re-checked after an artwork change)
without the original development workspace.

  python tools/render-pet-preview.py                 the pet and menu previews
  python tools/render-pet-preview.py --corners       tablet-quad overlays on every artwork
  python tools/render-pet-preview.py --digits        how long a balance still fits
  python tools/render-pet-preview.py --source DIR    also draw the wide-vs-square comparison

Previews are written to _previews/ (gitignored); the curated images that ship live in
docs/previews/. Requires Pillow.
"""

"""Render the pet — and its right-click menu and restore pill — exactly as the
browser draws them, so the visual result can be inspected without a screenshot of
the Web UI.

The pet part is a faithful port of `renderPet` / `drawTablet` / `drawFloating` in
`src/client.js`: the same layout, the same measured tablet corners, the same affine
mapping, the same font sizes and the same red-flash compositing. The menu part
reproduces the same structure, order and CSS metrics, drawn with Pillow because the real
one is DOM.

Run:  python tools/render-pet-preview.py
      python tools/render-pet-preview.py --corners
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont


# Console-safe output: a Windows console is often a legacy code page that cannot encode
# the ¥ sign or the Chinese copy, and printing them must not crash the tool.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover - very old or redirected stdout
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ASSETS = os.path.join(PKG, "assets")
# Only the wide-vs-square comparison needs the original source folder, and the wide pose
# is the one artwork that is not shipped. Point this anywhere via --source or
# DSH_PET_ASSET_SOURCE; without it that one sheet is skipped and everything else works.
SUPPLIED = os.environ.get("DSH_PET_ASSET_SOURCE", "")
for index, argument in enumerate(sys.argv):
    if argument == "--source" and index + 1 < len(sys.argv):
        SUPPLIED = sys.argv[index + 1]
# Scratch output. Gitignored: the curated images that ship live in docs/previews/.
OUT = os.path.join(PKG, "_previews")

FLOAT_BAND = 0.55
TABLET_WIDTH, TABLET_HEIGHT = 400, 220

# Artwork descriptors: nominal size + the measured tablet quad (tl, tr, bl).
ART_DEEPSEEK = {"width": 1024, "height": 1024,
                "corners": ((549.6, 706.2), (949.7, 642.0), (584.6, 924.3))}
ART_WIDE = {"width": 1536, "height": 1024,
            "corners": ((1060, 699), (1413, 644), (1090, 889))}
ART_WIDE_GEMINI = {"width": 1536, "height": 1024,
                   "corners": ((1065, 699), (1400, 646), (1095, 889))}

# (key, label, shipped file, art, tablet)
APPEARANCES = [
    ("deepseek", "蓝色大肥鱼", None, ART_DEEPSEEK, True),
    ("bowl", "抱盆大肥鱼", "appearance-bowl.webp", ART_WIDE, False),
    ("gpt", "GPT龙娘", "appearance-gpt.webp", ART_WIDE, True),
    ("claude", "大小姐Claude", "appearance-claude.webp", ART_WIDE, True),
    ("gemini", "北美猫娘Gemini", "appearance-gemini.webp", ART_WIDE_GEMINI, True),
]
EXPRESSIONS = [
    ("11", "开心", "expression-11.webp"),
    ("12", "傲娇", "expression-12.webp"),
    ("21", "冷脸", "expression-21.webp"),
    ("22", "紧张", "expression-22.webp"),
]
BOWL_FILE = "appearance-bowl.webp"

FONT_FILES = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc",
              r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\segoeui.ttf"]


def load_font(px, bold=False):
    index = 1 if (bold and os.path.basename(FONT_FILES[0]) == "msyh.ttc") else 0
    for path in FONT_FILES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, max(1, int(round(px))), index=index)
            except Exception:
                try:
                    return ImageFont.truetype(path, max(1, int(round(px))))
                except Exception:
                    continue
    return ImageFont.load_default()


def resolve(path_or_name):
    """A shipped asset name, or an absolute path (used for the comparison sheet)."""
    if os.path.isabs(path_or_name):
        return path_or_name
    shipped = os.path.join(ASSETS, path_or_name)
    if os.path.exists(shipped):
        return shipped
    for sub in ("外观", "四个差分表情"):
        candidate = os.path.join(SUPPLIED, sub, path_or_name)
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(path_or_name)


def layout(side, art):
    ratio = art["width"] / art["height"]
    height = side * (1 + FLOAT_BAND)
    sprite_h = side * 0.94
    sprite_w = sprite_h * ratio
    width = sprite_w + side * 0.09
    return {
        "side": side, "width": width, "height": height, "ratio": ratio,
        "sprite_left": (width - sprite_w) / 2,
        "sprite_top": height - side * 0.03 - sprite_h,
        "sprite_w": sprite_w, "sprite_h": sprite_h, "body_top": height - side,
    }


def tablet_matrix(art, sprite_left, sprite_top, sprite_w):
    scale = sprite_w / art["width"]
    (tlx, tly), (trx, try_), (blx, bly) = art["corners"]
    return (scale * (trx - tlx) / TABLET_WIDTH, scale * (try_ - tly) / TABLET_WIDTH,
            scale * (blx - tlx) / TABLET_HEIGHT, scale * (bly - tly) / TABLET_HEIGHT,
            sprite_left + scale * tlx, sprite_top + scale * tly)


def inverse_affine(a, b, c, d, e, f):
    det = a * d - b * c
    return (d / det, -c / det, (c * f - d * e) / det,
            -b / det, a / det, (b * e - a * f) / det)


def fen_string(cents):
    negative = cents < 0
    magnitude = abs(cents)
    return "%s%d.%02d" % ("-" if negative else "", magnitude // 100, magnitude % 100)


def render_tablet_panel(connected, text):
    """The 400 x 220 panel exactly as the canvas draws it, top-left origin."""
    panel = Image.new("RGBA", (TABLET_WIDTH, TABLET_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    label_color = (158, 184, 227, 255)

    title_font = load_font(TABLET_HEIGHT * 0.21, bold=True)
    title = "DSH 余额"
    tw = draw.textlength(title, font=title_font)
    draw.text((TABLET_WIDTH / 2 - tw / 2, TABLET_HEIGHT * 0.20), title,
              font=title_font, fill=label_color, anchor="lm")

    number_size = TABLET_HEIGHT * 0.48
    currency_size = TABLET_HEIGHT * 0.27
    currency = "¥ "

    def measure(factor):
        cf = load_font(currency_size * factor, bold=True)
        nf = load_font(number_size * factor, bold=True)
        return draw.textlength(currency, font=cf) + draw.textlength(text, font=nf)

    full = measure(1)
    factor = min(1, (TABLET_WIDTH * 0.90) / full) if full > 0 else 1
    cf = load_font(currency_size * factor, bold=True)
    nf = load_font(number_size * factor, bold=True)
    cw, nw = draw.textlength(currency, font=cf), draw.textlength(text, font=nf)
    start_x = (TABLET_WIDTH - (cw + nw)) / 2
    amount_y = TABLET_HEIGHT * 0.68
    draw.text((start_x, amount_y), currency, font=cf, fill=label_color, anchor="lm")
    draw.text((start_x + cw, amount_y), text, font=nf,
              fill=(240, 247, 255, 255) if connected else (173, 186, 207, 255), anchor="lm")

    dot = (34, 197, 94, 255) if connected else (239, 68, 68, 255)
    cx, cy, r = TABLET_WIDTH * 0.92 + 7.5, TABLET_HEIGHT * 0.23 - 7.5, 7.5
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot)
    return panel


def render(file_name, art, side, cents, connected, flash, floats, output,
           tablet=True, ring=0.0, background=None):
    box = layout(side, art)
    canvas = Image.new("RGBA", (int(round(box["width"])), int(round(box["height"]))), (0, 0, 0, 0))
    with Image.open(resolve(file_name)) as opened:
        sprite = opened.convert("RGBA").resize(
            (int(round(box["sprite_w"])), int(round(box["sprite_h"]))), Image.LANCZOS)

    if tablet:
        a, b, c, d, e, f = tablet_matrix(art, 0, 0, box["sprite_w"])
        panel = render_tablet_panel(connected, fen_string(cents) if connected else "--")
        placed = panel.transform(sprite.size, Image.AFFINE,
                                 inverse_affine(a, b, c, d, e, f), resample=Image.BICUBIC)
        sprite = Image.alpha_composite(sprite, placed)

    if flash > 0:
        tint = Image.new("RGBA", sprite.size, (255, 26, 36, int(round(255 * 0.45 * flash))))
        flashed = Image.alpha_composite(sprite, tint)
        mask = sprite.getchannel("A").point(lambda value: 255 if value > 0 else 0)
        sprite = Image.composite(flashed, sprite, mask)

    canvas.alpha_composite(sprite, (int(round(box["sprite_left"])), int(round(box["sprite_top"]))))

    if ring > 0:
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ring_draw = ImageDraw.Draw(overlay)
        inset = side * (0.03 + 0.06 * (1 - ring))
        ring_draw.ellipse(
            (box["sprite_left"] + inset, box["sprite_top"] + inset,
             box["sprite_left"] + box["sprite_w"] - inset, box["sprite_top"] + box["sprite_h"] - inset),
            outline=(46, 204, 113, int(round(255 * 0.8 * (1 - ring)))),
            width=max(1, int(round(side * 0.015))))
        canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas)
    font = load_font(side * 0.08, bold=True)
    for text, kind, progress in floats:
        alpha = max(0.0, 1 - progress ** 1.6)
        width = draw.textlength(text, font=font)
        x = min(max(0, box["width"] - side + side * 0.5 - width / 2), max(0, box["width"] - width))
        y = box["body_top"] + (side * 0.1 - box["body_top"]) * progress
        color = (60, 214, 120) if kind == "up" else (255, 74, 80)
        draw.text((x, y), text, font=font, fill=color + (int(round(255 * alpha)),), anchor="la")

    if background is not None:
        sheet = Image.new("RGBA", canvas.size, background)
        sheet.alpha_composite(canvas)
        canvas = sheet
    canvas.save(output)
    return output


# ---------------------------------------------------------------- menu mock

MENU_W = 208
MENU_ROW = 30
PANEL_BG = (31, 32, 35, 255)
BORDER = (58, 60, 66, 255)
TEXT = (232, 234, 238, 255)
DIM = (150, 154, 162, 255)
BRAND = (77, 107, 254, 255)
HOVER = (58, 61, 66, 255)


def draw_check(draw, x, y, colour):
    draw.line((x + 1, y + 5, x + 4, y + 8), fill=colour, width=2)
    draw.line((x + 4, y + 8, x + 10, y + 1), fill=colour, width=2)


def draw_chevron(draw, x, y, colour):
    draw.line((x + 2, y + 1, x + 6, y + 5), fill=colour, width=2)
    draw.line((x + 6, y + 5, x + 2, y + 9), fill=colour, width=2)


def draw_icon(draw, name, x, y, colour):
    """The same shapes the client's inline SVG icons use, roughly."""
    if name == "refresh":
        draw.arc((x + 1, y + 1, x + 13, y + 13), 40, 330, fill=colour, width=2)
        draw.line((x + 9, y + 1, x + 13, y + 2), fill=colour, width=2)
    elif name == "hide":
        draw.ellipse((x + 1, y + 3, x + 13, y + 11), outline=colour, width=2)
        draw.line((x + 2, y + 2, x + 12, y + 12), fill=colour, width=2)
    elif name == "show":
        draw.ellipse((x + 1, y + 3, x + 13, y + 11), outline=colour, width=2)
        draw.ellipse((x + 6, y + 6, x + 8, y + 8), fill=colour)
    elif name == "size":
        draw.line((x + 1, y + 12, x + 13, y + 12), fill=colour, width=2)
        for offset, top in ((2, 7), (6, 4), (10, 8)):
            draw.line((x + offset + 1, y + 12, x + offset + 1, y + top), fill=colour, width=2)
    elif name == "appearance":
        draw.ellipse((x + 4, y + 1, x + 10, y + 7), outline=colour, width=2)
        draw.arc((x + 1, y + 7, x + 13, y + 16), 180, 360, fill=colour, width=2)
    elif name == "expression":
        draw.ellipse((x + 1, y + 1, x + 13, y + 13), outline=colour, width=2)
        draw.point((x + 4, y + 5), fill=colour)
        draw.point((x + 9, y + 5), fill=colour)
        draw.arc((x + 4, y + 6, x + 10, y + 11), 20, 160, fill=colour, width=2)
    elif name == "snap":
        draw.line((x + 12, y + 12, x + 12, y + 2, x + 2, y + 2), fill=colour, width=2)
        draw.line((x + 6, y + 8, x + 2, y + 12), fill=colour, width=2)
        draw.line((x + 2, y + 8, x + 2, y + 12, x + 6, y + 12), fill=colour, width=2)
    elif name == "clock":
        draw.ellipse((x + 1, y + 1, x + 13, y + 13), outline=colour, width=2)
        draw.line((x + 7, y + 4, x + 7, y + 8, x + 10, y + 9), fill=colour, width=2)
    elif name == "key":
        draw.ellipse((x + 1, y + 5, x + 7, y + 11), outline=colour, width=2)
        draw.line((x + 6, y + 6, x + 13, y + 1), fill=colour, width=2)
        draw.line((x + 10, y + 3, x + 12, y + 5), fill=colour, width=2)
    elif name == "source":
        for offset in (2, 6, 10):
            draw.line((x + 1, y + offset, x + 13, y + offset), fill=colour, width=2)
    elif name == "clear":
        draw.line((x + 3, y + 3, x + 11, y + 11), fill=colour, width=2)
        draw.line((x + 11, y + 3, x + 3, y + 11), fill=colour, width=2)


def render_menu(output, entries):
    """entries: (kind, icon, label, right), kind in
    status/group/sep/item/toggle/submenu/option/note."""
    height = 11
    for kind, _, _, _ in entries:
        height += {"sep": 11, "group": 29, "note": 16}.get(kind, MENU_ROW)
    width = MENU_W + 2
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=10, fill=PANEL_BG, outline=BORDER)

    label_font = load_font(13)
    small_font = load_font(11)
    value_font = load_font(12)
    y = 5
    for kind, icon, label, right in entries:
        if kind == "sep":
            draw.line((8, y + 5, width - 8, y + 5), fill=BORDER)
            y += 11
            continue
        if kind == "group":
            draw.text((10, y + 9), label, font=small_font, fill=(DIM[0], DIM[1], DIM[2], 184))
            y += 29
            continue
        if kind == "note":
            draw.text((10, y), label, font=small_font, fill=(DIM[0], DIM[1], DIM[2], 204))
            y += 16
            continue
        if kind == "status":
            draw.text((10, y + 8), label, font=value_font, fill=DIM)
            y += MENU_ROW
            continue

        if kind in ("submenu", "toggle") and right == "hover":
            draw.rounded_rectangle((5, y, width - 6, y + MENU_ROW - 1), radius=7, fill=HOVER)
        if icon:
            draw_icon(draw, icon, 9, y + 7, (215, 218, 224, 255))
        draw.text((34, y + 5), label, font=label_font, fill=TEXT)
        if kind == "submenu":
            if right:
                tw = draw.textlength(right, font=value_font)
                draw.text((width - 30 - tw, y + 6), right, font=value_font, fill=DIM)
            draw_chevron(draw, width - 22, y + 10, (170, 174, 182, 255))
        elif kind in ("toggle", "option") and right == "on":
            draw_check(draw, width - 24, y + 10, BRAND)
        y += MENU_ROW
    panel.save(output)
    return output


def render_sheets():
    made = []
    root_path = render_menu(os.path.join(OUT, "_menu-root.png"), [
        ("status", None, "¥ 25.91 · DSH 账号", None),
        ("item", "refresh", "立即刷新余额", None),
        ("item", "hide", "隐藏桌宠", None),
        ("sep", None, None, None),
        ("group", None, "显示", None),
        ("submenu", "size", "尺寸", "中"),
        ("submenu", "appearance", "外观", "蓝色大肥鱼"),
        ("submenu", "expression", "表情", "开心"),
        ("toggle", "snap", "吸附（松手回左下角）", "on"),
        ("sep", None, None, None),
        ("group", None, "余额", None),
        ("submenu", "source", "余额来源", "自动"),
        ("item", "key", "设置 API Key…", None),
        ("submenu", "clock", "刷新间隔", "30 秒"),
    ])
    sub_appearance = render_menu(os.path.join(OUT, "_menu-appearance.png"), [
        ("option", None, "蓝色大肥鱼", "on"),
        ("option", None, "抱盆大肥鱼", None),
        ("option", None, "GPT龙娘", None),
        ("option", None, "大小姐Claude", None),
        ("option", None, "北美猫娘Gemini", None),
    ])
    sub_expression = render_menu(os.path.join(OUT, "_menu-expression.png"), [
        ("option", None, "开心", "on"),
        ("note", None, "笑口常开（默认）", None),
        ("option", None, "傲娇", None),
        ("note", None, "抿嘴侧目，别过头去", None),
        ("option", None, "冷脸", None),
        ("note", None, "眯眼，面无表情", None),
        ("option", None, "紧张", None),
        ("note", None, "扣费时自动使用，扣完再保持 1 秒", None),
    ])
    root = Image.open(root_path).convert("RGBA")
    appearance = Image.open(sub_appearance).convert("RGBA")
    expression = Image.open(sub_expression).convert("RGBA")

    gap = 10
    columns = [root, appearance, expression]
    width = sum(t.width for t in columns) + gap * (len(columns) - 1)
    height = max(t.height for t in columns)
    sheet = Image.new("RGBA", (width, height), (18, 19, 22, 255))
    x = 0
    for tile in columns:
        sheet.alpha_composite(tile, (x, 0))
        x += tile.width + gap
    made.append(os.path.join(OUT, "menu.png"))
    sheet.convert("RGB").save(made[-1])

    for path in (root_path, sub_appearance, sub_expression):
        os.remove(path)
    return made


def render_comment_sheet(output):
    """Wide framing versus the square differential framing, at the same body size.

    The wide pose is the one artwork that is NOT shipped (蓝色大肥鱼 is served by the
    differential set), so this needs the original source folder. When that folder is gone
    the sheet is simply skipped: the already-rendered copy in docs/previews/ still ships.
    """
    wide = os.path.join(SUPPLIED, "外观", "sprite.png")
    if not os.path.exists(wide):
        print("skipping wide-vs-square: the source pose is not present at %s" % wide)
        print("  (docs/previews/wide-vs-square.webp already holds a rendered copy)")
        return None
    sources = [
        (os.path.join(SUPPLIED, "外观", "sprite.png"), ART_WIDE,
         "外观/sprite.png  1536x1024  宽"),
        (os.path.join(ASSETS, "expression-11.webp"), ART_DEEPSEEK,
         "四个差分表情/expression_11  1024x1024  方"),
    ]
    side = 240
    tiles = []
    for path, art, caption in sources:
        tile_path = os.path.join(OUT, "_cmp.png")
        render(path, art, side, 2591, True, 0.0, [], tile_path, background=(26, 28, 34, 255))
        tile = Image.open(tile_path).convert("RGBA")
        os.remove(tile_path)
        label = Image.new("RGBA", (tile.width, tile.height + 26), (26, 28, 34, 255))
        label.alpha_composite(tile, (0, 0))
        ImageDraw.Draw(label).text((10, tile.height + 6), caption, font=load_font(12),
                                   fill=(190, 194, 202, 255), anchor="la")
        tiles.append(label)

    gap = 24
    width = sum(t.width for t in tiles) + gap
    height = max(t.height for t in tiles)
    sheet = Image.new("RGBA", (width, height), (26, 28, 34, 255))
    x = 0
    for tile in tiles:
        sheet.alpha_composite(tile, (x, 0))
        x += tile.width + gap
    sheet.convert("RGB").save(output)
    return output


def render_corner_overlays():
    """Draw each artwork's measured tablet quad onto the source image.

    This is the check to run first if the balance ever lands off the screen.
    """
    made = []
    sources = [("expression-%s.webp" % key, ART_DEEPSEEK) for key, _, _ in EXPRESSIONS]
    sources += [(file_name, art) for _, _, file_name, art, _ in APPEARANCES if file_name]
    for file_name, art in sources:
        with Image.open(resolve(file_name)) as opened:
            image = opened.convert("RGBA")
        background = Image.new("RGBA", image.size, (70, 70, 78, 255))
        background.alpha_composite(image)
        scale = art["width"] / image.width
        (tlx, tly), (trx, try_), (blx, bly) = art["corners"]
        tl = (tlx / scale, tly / scale)
        tr = (trx / scale, try_ / scale)
        bl = (blx / scale, bly / scale)
        br = (tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1])
        draw = ImageDraw.Draw(background)
        draw.polygon([tl, tr, br, bl], outline=(255, 0, 0), width=4)
        for point, colour in ((tl, (0, 255, 0)), (tr, (0, 0, 255)), (bl, (255, 255, 0))):
            draw.ellipse((point[0] - 10, point[1] - 10, point[0] + 10, point[1] + 10), fill=colour)
        pad = 70
        target = os.path.join(OUT, "corners-%s.png" % file_name.replace(".webp", ""))
        background.crop((int(tl[0] - pad), int(tl[1] - pad),
                         int(tr[0] + pad), int(bl[1] + pad))).save(target)
        made.append(target)
    return made


def tablet_fit(text):
    """The canvas' own auto-shrink, in panel units.

    `drawTablet` measures `"¥ " + amount` at the full sizes, then scales BOTH down by
    `min(1, panelWidth * 0.9 / measured)` so a long amount is shrunk to fit rather
    than clipped. This reproduces that decision so the digit report is exact.
    """
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    number_size = TABLET_HEIGHT * 0.48
    currency_size = TABLET_HEIGHT * 0.27
    currency_font = load_font(currency_size, bold=True)
    number_font = load_font(number_size, bold=True)
    full = probe.textlength("¥ ", font=currency_font) + probe.textlength(text, font=number_font)
    factor = min(1.0, (TABLET_WIDTH * 0.9) / full) if full > 0 else 1.0
    return {
        "factor": factor,
        "shrunk": factor < 0.999,
        "number_px": number_size * factor,
        "share": (number_size * factor) / TABLET_HEIGHT,
    }


def render_digit_report(output, amounts):
    """Render the tablet screen for a range of balances, with the fit maths."""
    rows = []
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    for amount in amounts:
        text = fen_string(int(round(amount * 100)))
        fit = tablet_fit(text)
        panel = render_tablet_panel(True, text)
        crop = Image.new("RGBA", (TABLET_WIDTH, TABLET_HEIGHT + 30), (22, 23, 27, 255))
        crop.alpha_composite(panel, (0, 0))
        caption = "¥%-10s  %s  数字高 %.0f/220  (%.0f%%)" % (
            text,
            "缩放到 %.0f%%" % (fit["factor"] * 100) if fit["shrunk"] else "原始大小 ",
            fit["number_px"],
            fit["share"] * 100,
        )
        ImageDraw.Draw(crop).text((10, TABLET_HEIGHT + 7), caption, font=load_font(12),
                                  fill=(198, 202, 210, 255), anchor="la")
        rows.append(crop)

    gap = 10
    width = max(r.width for r in rows) + 20
    height = sum(r.height for r in rows) + gap * (len(rows) - 1) + 20
    sheet = Image.new("RGBA", (width, height), (18, 19, 22, 255))
    y = 10
    for row in rows:
        sheet.alpha_composite(row, (10, y))
        y += row.height + gap
    sheet.convert("RGB").save(output)
    return output


def main():
    os.makedirs(OUT, exist_ok=True)

    if "--digits" in sys.argv:
        amounts = [0.99, 12.34, 123.11, 1234.56, 12345.67, 99999.99]
        target = render_digit_report(os.path.join(OUT, "digits.png"), amounts)
        print("%-52s %7d bytes" % (os.path.basename(target), os.path.getsize(target)))
        print("")
        print("%-12s %-10s %-12s %s" % ("balance", "shrink", "digits (of 220)", "as a share of the tablet"))
        for amount in amounts:
            text = fen_string(int(round(amount * 100)))
            fit = tablet_fit(text)
            print("%-12s %-10s %-12.0f %.0f%%" % (
                "¥" + text,
                "%.0f%%" % (fit["factor"] * 100) if fit["shrunk"] else "none",
                fit["number_px"],
                fit["share"] * 100,
            ))
        return 0

    if "--corners" in sys.argv:
        for path in render_corner_overlays():
            print("%-52s %7d bytes" % (os.path.basename(path), os.path.getsize(path)))
        print("\ncorner overlays in %s" % os.path.normpath(OUT))
        return 0

    made = []
    balance = 2591

    for key, _, file_name in EXPRESSIONS:
        made.append(render(file_name, ART_DEEPSEEK, 150, balance, True, 0.0, [],
                           os.path.join(OUT, "expression-%s.png" % key)))

    for key, _, file_name, art, tablet in APPEARANCES[1:]:
        made.append(render(file_name, art, 150, balance, True, 0.0, [],
                           os.path.join(OUT, "appearance-%s.png" % key), tablet=tablet))

    # The two reactions that were kept.
    made.append(render("expression-22.webp", ART_DEEPSEEK, 150, balance, True, 1.0,
                       [("-0.01", "down", 0.25)], os.path.join(OUT, "drop.png")))
    made.append(render("expression-11.webp", ART_DEEPSEEK, 150, balance + 200, True, 0.0,
                       [("+2.00", "up", 0.25)], os.path.join(OUT, "topup.png"), ring=0.35))

    # The automatic offline pose, and the largest preset.
    made.append(render(BOWL_FILE, ART_WIDE, 150, 0, False, 0.0, [],
                       os.path.join(OUT, "bowl.png"), tablet=False))
    made.append(render("expression-11.webp", ART_DEEPSEEK, 280, balance, True, 0.0, [],
                       os.path.join(OUT, "size-large.png")))

    tiles = [Image.open(os.path.join(OUT, "expression-%s.png" % key)).convert("RGBA")
             for key, _, _ in EXPRESSIONS]
    sheet = Image.new("RGBA", (sum(t.width for t in tiles), max(t.height for t in tiles)), (26, 28, 34, 255))
    x = 0
    for tile in tiles:
        sheet.alpha_composite(tile, (x, 0))
        x += tile.width
    made.append(os.path.join(OUT, "expressions.png"))
    sheet.convert("RGB").save(made[-1])

    made.extend(render_sheets())
    comparison = render_comment_sheet(os.path.join(OUT, "wide-vs-square.png"))
    if comparison is not None:
        made.append(comparison)

    for path in made:
        print("%-46s %7d bytes" % (os.path.basename(path), os.path.getsize(path)))
    print("\npreviews in %s" % os.path.normpath(OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
