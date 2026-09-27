"""ホーム画面用アイコン（PNG）を追加ライブラリなしで生成する。

    python3 scripts/make_icons.py

黒地に、ループ矢印をイメージした円弧と音声の波形バーを描く。
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public"
BG = (0, 0, 0)
ACCENT = (245, 185, 66)
DIM = (90, 70, 30)


def render(size: int) -> bytes:
    ss = 3  # アンチエイリアス用のサブサンプル数
    rows = []
    c = size / 2
    r_out, r_in = size * 0.36, size * 0.30
    bars = [0.10, 0.20, 0.32, 0.20, 0.14]
    bar_w = size * 0.045
    gap = size * 0.03
    total = len(bars) * bar_w + (len(bars) - 1) * gap
    x0 = c - total / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    col = BG
                    dx, dy = px - c, py - c
                    d = math.hypot(dx, dy)
                    ang = (math.degrees(math.atan2(dy, dx)) + 360) % 360
                    if r_in <= d <= r_out and not (300 <= ang <= 345):
                        col = ACCENT
                    # 円弧の切れ目に矢じり
                    ax, ay = c + (r_in + r_out) / 2 * math.cos(math.radians(300)), c + (r_in + r_out) / 2 * math.sin(math.radians(300))
                    if math.hypot(px - ax, py - ay) < size * 0.07 and ang <= 300 and ang > 250 and d > r_in - size * 0.05 and d < r_out + size * 0.05:
                        col = ACCENT
                    for i, h in enumerate(bars):
                        bx = x0 + i * (bar_w + gap)
                        hh = size * h
                        if bx <= px <= bx + bar_w and c - hh / 2 <= py <= c + hh / 2:
                            col = ACCENT if i == 2 else (230, 230, 232)
                    for k in range(3):
                        acc[k] += col[k]
            n = ss * ss
            row += bytes(int(v / n) for v in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        (OUT / name).write_bytes(render(size))
        print("wrote", name)
    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#000"/>'
        '<path d="M50 20A21 21 0 1 0 53 32" fill="none" stroke="#f5b942" stroke-width="5"/>'
        '<rect x="23" y="26" width="3" height="12" fill="#e6e6e8"/>'
        '<rect x="30.5" y="21" width="3" height="22" fill="#f5b942"/>'
        '<rect x="38" y="26" width="3" height="12" fill="#e6e6e8"/></svg>')
    print("wrote favicon.svg")


if __name__ == "__main__":
    main()
