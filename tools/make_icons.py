"""A안 로고(방패 + `>_` 커서)를 Chrome Web Store용 PNG 아이콘 4종으로 굽습니다.

SVG 표준 라이브러리만으로는 래스터화가 안 되므로, 로고 A안의 기하(방패 폴리곤 +
내부 스트로크 + `>_` 텍스트)를 PIL로 직접 그려 슈퍼샘플링 후 LANCZOS로
축소합니다. 외부 패키지/네트워크 없이 표준 Windows 폰트만 사용합니다.

작은 크기(기본 24px 미만)에서는 내부 링과 얇은 획이 뭉개지므로 자동으로
단순화 버전(내부 링 제거 + 글리프 확대)을 사용합니다.

사용법:
    py tools/make_icons.py
    py tools/make_icons.py --out browser-extension/icons --sizes 16,32,48,128
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# logo-a.svg와 동일한 128 기준 좌표계
VIEWBOX = 128.0
BRAND = (21, 94, 239, 255)  # #155eef
INK = (255, 255, 255, 255)

# M64 6 L110 24 V66 C110 94 88 112 64 122 C40 112 18 94 18 66 V24 Z
OUTER_ANCHORS = [(64, 6), (110, 24), (110, 66)]
OUTER_CURVE_1 = [(110, 66), (110, 94), (88, 112), (64, 122)]
OUTER_CURVE_2 = [(64, 122), (40, 112), (18, 94), (18, 66)]
OUTER_TAIL = [(18, 24)]

# M64 16 L100 30 V66 C100 88 82 102 64 110 C46 102 28 88 28 66 V30 Z
INNER_ANCHORS = [(64, 16), (100, 30), (100, 66)]
INNER_CURVE_1 = [(100, 66), (100, 88), (82, 102), (64, 110)]
INNER_CURVE_2 = [(64, 110), (46, 102), (28, 88), (28, 66)]
INNER_TAIL = [(28, 30)]

INNER_STROKE_WIDTH = 5.0  # logo-a.svg의 stroke-width
GLYPH = ">_"
GLYPH_SIZE = 38.0  # logo-a.svg의 font-size
# 단순화 버전(작은 크기): 내부 링을 빼고, `_`를 제거한 `>`만 크게 그립니다.
# 16px에서는 `>_` 두 글자가 뭉개져 셰브론 하나가 더 잘 읽힙니다.
SMALL_GLYPH = ">"
SMALL_GLYPH_SIZE = 68.0
FONT_CANDIDATES = ("consolab.ttf", "consola.ttf", "arialbd.ttf", "arial.ttf")


def cubic_points(p0, p1, p2, p3, steps=48):
    """3차 베지어 곡선을 폴리곤용 점 목록으로 샘플링합니다."""
    points = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def outline(anchors, curve1, curve2, tail):
    """닫힌 외곽선 점 목록을 만듭니다(첫 점으로 되돌아옴)."""
    points = list(anchors)
    points += cubic_points(*curve1)
    points += cubic_points(*curve2)
    points += list(tail)
    return points


def find_font(font_dir: Path, size: int) -> ImageFont.FreeTypeFont:
    for name in FONT_CANDIDATES:
        candidate = font_dir / name
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    raise SystemExit(
        f"사용 가능한 폰트를 찾지 못했습니다: {font_dir} ({', '.join(FONT_CANDIDATES)})"
    )


def render(size, supersample, font_dir, simplify_below=24):
    canvas = int(size) * supersample
    scale = canvas / VIEWBOX
    simple = size < simplify_below

    def to_px(points):
        return [(x * scale, y * scale) for x, y in points]

    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    draw.polygon(
        to_px(outline(OUTER_ANCHORS, OUTER_CURVE_1, OUTER_CURVE_2, OUTER_TAIL)),
        fill=BRAND,
    )

    if not simple:
        inner = to_px(outline(INNER_ANCHORS, INNER_CURVE_1, INNER_CURVE_2, INNER_TAIL))
        inner.append(inner[0])
        draw.line(
            inner,
            fill=(255, 255, 255, 229),  # logo-a.svg의 opacity 0.9
            width=max(1, round(INNER_STROKE_WIDTH * scale)),
            joint="curve",
        )

    # `>_` 글리프는 자체 레이어에 그린 뒤 방패 중심에 맞춰 붙입니다.
    glyph_text = SMALL_GLYPH if simple else GLYPH
    glyph_units = SMALL_GLYPH_SIZE if simple else GLYPH_SIZE
    font = find_font(font_dir, max(1, round(glyph_units * scale)))
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((0, 0), glyph_text, font=font, fill=INK)
    box = layer.getbbox()
    if box is not None:
        glyph = layer.crop(box)
        # 방패 시각 중심(64, 66)에 글리프 중심을 맞춥니다.
        cx, cy = 64.0 * scale, 66.0 * scale
        img.alpha_composite(
            glyph,
            (round(cx - glyph.width / 2), round(cy - glyph.height / 2)),
        )

    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser(description="A안 로고 PNG 아이콘 생성기")
    parser.add_argument(
        "--out",
        default="browser-extension/icons",
        help="PNG를 저장할 폴더 (기본: browser-extension/icons)",
    )
    parser.add_argument("--sizes", default="16,32,48,128", help="쉼표로 구분한 픽셀 크기")
    parser.add_argument("--supersample", type=int, default=8, help="슈퍼샘플링 배율")
    parser.add_argument(
        "--simplify-below",
        type=int,
        default=24,
        help="이 크기(px) 미만은 내부 링을 빼고 글리프를 키운 단순화 버전 사용",
    )
    parser.add_argument(
        "--font-dir",
        default=str(Path("C:/Windows/Fonts")),
        help="폰트 폴더 (기본: C:/Windows/Fonts)",
    )
    args = parser.parse_args()

    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    font_dir = Path(args.font_dir)

    for size in sizes:
        image = render(size, max(1, args.supersample), font_dir, args.simplify_below)
        target = out_dir / f"icon{size}.png"
        image.save(target, "PNG", optimize=True)
        mode = "simple" if size < args.simplify_below else "full"
        print(f"wrote {target} ({image.width}x{image.height}, {mode})")

    return 0


if __name__ == "__main__":
    sys.exit(main())

