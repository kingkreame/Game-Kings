#!/usr/bin/env python3
"""Crop painted chess art into transparent WebP pieces and measure board grids.

Reads the source JPEGs from a directory (default: the bot chess-art store) and
writes web assets plus src/client/art-metrics.ts. Re-run when the paintings change.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

PIECES = ("k", "q", "b", "n", "r", "p")
COLORS = ("w", "b")


def measure_board(path: Path) -> dict:
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    height, width = im.shape[:2]
    lum = 0.2126 * im[:, :, 0] + 0.7152 * im[:, :, 1] + 0.0722 * im[:, :, 2]
    smooth = cv2.GaussianBlur(lum, (0, 0), 0.8)
    gx = np.abs(cv2.Sobel(smooth, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3))

    def peaks(profile: np.ndarray, min_dist: int = 70) -> list[tuple[int, float]]:
        threshold = float(np.percentile(profile, 96))
        found: list[tuple[int, float]] = []
        for index in range(2, len(profile) - 2):
            value = float(profile[index])
            if value < threshold:
                continue
            if value < profile[index - 1] or value < profile[index + 1]:
                continue
            if value < profile[index - 2] or value < profile[index + 2]:
                continue
            if found and index - found[-1][0] < min_dist:
                if value > found[-1][1]:
                    found[-1] = (index, value)
                continue
            found.append((index, value))
        return found

    rows = [int(height * t) for t in (0.16, 0.22, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.84)]
    cols = [int(width * t) for t in (0.16, 0.22, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.84)]
    x_profile = np.mean([gx[y] for y in rows], axis=0)
    y_profile = np.mean([gy[:, x] for x in cols], axis=0)

    def fit_axis(points: list[tuple[int, float]], limit: int) -> tuple[float, float]:
        coords = np.array(sorted(point[0] for point in points), dtype=np.float64)
        if len(coords) < 5:
            raise RuntimeError(f"Not enough grid edges in {path.name}")
        best: tuple[tuple[int, float], float, float] | None = None
        for spacing in np.linspace(limit * 0.098, limit * 0.112, 29):
            for origin in np.linspace(limit * 0.045, limit * 0.13, 45):
                lines = origin + np.arange(9) * spacing
                if lines[-1] > limit - 8:
                    continue
                hits = 0
                error = 0.0
                for line in lines:
                    delta = float(np.min(np.abs(coords - line)))
                    if delta < 7:
                        hits += 1
                        error += delta * delta
                    else:
                        error += 40
                score = (hits, -error)
                if best is None or score > best[0]:
                    best = (score, float(origin), float(spacing))
        if best is None or best[0][0] < 6:
            raise RuntimeError(f"Could not fit the 8x8 grid in {path.name}")
        return best[1], best[2]

    x0, sx = fit_axis(peaks(x_profile), width)
    y0, sy = fit_axis(peaks(y_profile), height)

    def nudge(origin: float, spacing: float, horizontal: bool) -> float:
        best_origin = origin
        best_score = -1e18
        for delta in np.linspace(-6, 6, 49):
            start = origin + float(delta)
            score = 0.0
            for i in range(8):
                center = start + (i + 0.5) * spacing
                inside = center
                outside = start - spacing * 0.12 if i == 0 else start + 8 * spacing + spacing * 0.12
                if horizontal:
                    a = int(np.clip(inside, 1, width - 2))
                    b = int(np.clip(outside, 1, width - 2))
                    y = int(np.clip(y0 + 0.5 * sy, 1, height - 2))
                    score += abs(float(lum[y, a] - lum[y, b]))
                else:
                    a = int(np.clip(inside, 1, height - 2))
                    b = int(np.clip(outside, 1, height - 2))
                    x = int(np.clip(x0 + 0.5 * sx, 1, width - 2))
                    score += abs(float(lum[a, x] - lum[b, x]))
            if score > best_score:
                best_score = score
                best_origin = start
        return best_origin

    x0 = nudge(x0, sx, True)
    y0 = nudge(y0, sy, False)

    def square_lum(row: int, col: int) -> float:
        top = int(round(y0 + row * sy + sy * 0.28))
        bottom = int(round(y0 + (row + 1) * sy - sy * 0.28))
        left = int(round(x0 + col * sx + sx * 0.28))
        right = int(round(x0 + (col + 1) * sx - sx * 0.28))
        return float(lum[top:bottom, left:right].mean())

    a8 = square_lum(0, 0)
    h8 = square_lum(0, 7)
    a1 = square_lum(7, 0)
    h1 = square_lum(7, 7)
    if not (a1 < h1 and a8 > h8):
        raise RuntimeError(
            f"{path.name} orientation failed a1={a1:.1f} h1={h1:.1f} a8={a8:.1f} h8={h8:.1f}"
        )
    return {
        "x": x0 / width,
        "y": y0 / height,
        "w": (8 * sx) / width,
        "h": (8 * sy) / height,
        "a1": round(a1, 2),
        "h1": round(h1, 2),
        "a8": round(a8, 2),
        "h8": round(h8, 2),
    }


def cut_pieces(path: Path) -> list[Image.Image]:
    bgr = cv2.imread(str(path))
    if bgr is None:
        raise RuntimeError(f"Could not read {path}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    floated = rgb.astype(np.float32)
    luminance = floated.mean(axis=2)
    blurred = cv2.GaussianBlur(luminance, (0, 0), 2.5)
    deviation = np.sqrt(cv2.GaussianBlur((luminance - blurred) ** 2, (0, 0), 2.5))
    chroma = floated.max(axis=2) - floated.min(axis=2)
    border = np.concatenate(
        [
            rgb[:16].reshape(-1, 3),
            rgb[-16:].reshape(-1, 3),
            rgb[:, :16].reshape(-1, 3),
            rgb[:, -16:].reshape(-1, 3),
        ]
    )
    background = np.median(border, axis=0)
    color_gap = np.max(np.abs(floated - background), axis=2)
    core = (deviation > 3.5) | (chroma > 12)
    core = ndimage.binary_opening(core, iterations=1)
    labels, _count = ndimage.label(core)
    sizes = np.bincount(labels.ravel())
    kept = np.zeros_like(core)
    for index, size in enumerate(sizes):
        if index and size > 80:
            kept[labels == index] = True
    distance = ndimage.distance_transform_edt(~kept)
    flat = (deviation < 1.15) & (chroma < 10)
    foreground = kept | ((distance <= 6.5) & ~flat)
    # Drop the charcoal fringe. Onyx stays because its pixels sit farther from the backdrop.
    foreground &= ~((color_gap < 9) & flat)
    foreground = ndimage.binary_closing(foreground, iterations=1)
    foreground = ndimage.binary_fill_holes(foreground)
    labels, _count = ndimage.label(foreground)
    sizes = np.bincount(labels.ravel())
    pieces: list[tuple[float, float, np.ndarray]] = []
    height = rgb.shape[0]
    for index, size in enumerate(sizes):
        if not index or size < 2500:
            continue
        mask = labels == index
        ys, xs = np.where(mask)
        if ys.max() - ys.min() > height * 0.55:
            rows = np.bincount(ys, minlength=height)
            gutter = np.where(rows < 20)[0]
            gutter = gutter[(gutter > ys.min() + 40) & (gutter < ys.max() - 40)]
            if len(gutter) == 0:
                split_at = int((ys.min() + ys.max()) / 2)
            else:
                # Split through the empty gap between the two pieces, not a narrow stem.
                breaks = np.where(np.diff(gutter) > 1)[0]
                spans = np.split(gutter, breaks + 1)
                best = max(spans, key=len)
                split_at = int(best[len(best) // 2])
            for part, selector in (
                ("top", ys < split_at),
                ("bottom", ys >= split_at),
            ):
                if selector.sum() < 2000:
                    continue
                part_mask = np.zeros_like(mask)
                part_mask[ys[selector], xs[selector]] = True
                py, px = np.where(part_mask)
                pieces.append((float(py.mean()), float(px.mean()), part_mask))
            continue
        pieces.append((float(ys.mean()), float(xs.mean()), mask))

    pieces.sort(key=lambda item: item[0])
    midpoint = (pieces[0][0] + pieces[-1][0]) / 2 if pieces else height / 2
    rows = [
        sorted([item for item in pieces if item[0] < midpoint], key=lambda item: item[1]),
        sorted([item for item in pieces if item[0] >= midpoint], key=lambda item: item[1]),
    ]
    if len(rows[0]) != 6 or len(rows[1]) != 6:
        raise RuntimeError(f"{path.name} yielded {[len(row) for row in rows]} pieces, expected 6 and 6")

    rendered: list[Image.Image] = []
    for row in rows:
        for _cy, _cx, mask in row:
            solid = ndimage.binary_fill_holes(mask)
            inward = ndimage.distance_transform_edt(solid)
            alpha = np.clip(inward / 1.35, 0, 1)
            rim = inward < 2.6
            alpha[rim & (color_gap < 8)] = 0
            soften = rim & (color_gap >= 8) & (color_gap < 18)
            alpha[soften] *= (color_gap[soften] - 8) / 10
            alpha = ndimage.gaussian_filter(alpha, 0.35)
            alpha[~ndimage.binary_dilation(solid, iterations=1)] = 0
            ys, xs = np.where(alpha > 0.08)
            if len(ys) == 0:
                continue
            pad = 2
            top = max(0, int(ys.min()) - pad)
            left = max(0, int(xs.min()) - pad)
            bottom = min(rgb.shape[0], int(ys.max()) + pad + 1)
            right = min(rgb.shape[1], int(xs.max()) + pad + 1)
            crop = rgb[top:bottom, left:right]
            crop_alpha = (np.clip(alpha[top:bottom, left:right], 0, 1) * 255).astype(np.uint8)
            image = Image.fromarray(crop).convert("RGBA")
            image.putalpha(Image.fromarray(crop_alpha))
            box = image.getbbox()
            if box:
                image = image.crop(box)
            image.thumbnail((236, 236), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
            canvas.paste(image, ((256 - image.width) // 2, (256 - image.height) // 2), image)
            rendered.append(canvas)
    return rendered


def write_board(src: Path, dest: Path) -> None:
    image = Image.open(src).convert("RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, "WEBP", quality=90, method=6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("/cursor/stores/bot/chess-art"),
    )
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "art")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sets = {
        "classic": ("chess_pieces_sheet.jpg", "chess_board.jpg"),
        "exotic": ("chess_pieces_exotic.jpg", "chess_board_exotic.jpg"),
    }
    metrics: dict[str, dict] = {}
    for name, (pieces_name, board_name) in sets.items():
        pieces = cut_pieces(args.source / pieces_name)
        folder = args.out / name
        folder.mkdir(parents=True, exist_ok=True)
        for index, image in enumerate(pieces):
            color = COLORS[index // 6]
            symbol = PIECES[index % 6]
            image.save(folder / f"{color}{symbol}.webp", "WEBP", quality=86, method=6)
        board_metrics = measure_board(args.source / board_name)
        write_board(args.source / board_name, folder / "board.webp")
        metrics[name] = board_metrics
        print(name, json.dumps(board_metrics))
    lines = [
        "/* Generated by scripts/prepare-art.py. Fractions of each board image. */",
        "export interface BoardMetrics {",
        "  board: string",
        "  x: number",
        "  y: number",
        "  w: number",
        "  h: number",
        "  a1: number",
        "  h1: number",
        "}",
        "export const ART: Record<'classic' | 'exotic', BoardMetrics> = {",
    ]
    for name, board in metrics.items():
        lines.append(f"  {name}: {{")
        lines.append(f"    board: '/art/{name}/board.webp',")
        lines.append(f"    x: {board['x']:.6f},")
        lines.append(f"    y: {board['y']:.6f},")
        lines.append(f"    w: {board['w']:.6f},")
        lines.append(f"    h: {board['h']:.6f},")
        lines.append(f"    a1: {board['a1']},")
        lines.append(f"    h1: {board['h1']},")
        lines.append("  },")
    lines.append("}")
    lines.append("")
    target = root / "src" / "client" / "art-metrics.ts"
    target.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", target)


if __name__ == "__main__":
    main()
