#!/usr/bin/env python3
"""チャットで作った「話題・発言ブロック・日本語訳」の JSON を、スクリプト JSON に取り込む。

    python add_bilingual.py "episode.json" "episode_bilingual.json"

- 発言ブロック（segments）→ paragraphs（話者と日本語訳を持つ段落）
- 話題（sections）      → topics（アプリで見出しになり、タップで区間になる）
- 文の区切りは、段落の境目をまたがないように作り直す
- 元のスクリプト JSON は同じ場所に .bak として 1 度だけ保存してから上書きする

bilingual JSON の時刻は DaVinci のタイムコード（HH:MM:SS;FF）で、
タイムラインの始まり（既定 01:00:00;00）を音声の 0 秒として扱う。
"""
from __future__ import annotations

import argparse
import bisect
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from transcript import sentences


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="話題・段落・日本語訳をスクリプト JSON に取り込む")
    p.add_argument("transcript", type=Path, help="make_transcript.py が作った JSON")
    p.add_argument("bilingual", type=Path, help="話題・発言ブロック・日本語訳の JSON")
    p.add_argument("--fps", type=float, default=30.0, help="タイムコードのフレームレート（既定 30）")
    p.add_argument("--timeline-start", default="01:00:00:00",
                   help="音声の 0 秒にあたるタイムコード（既定 01:00:00:00）")
    p.add_argument("--soft-max-words", type=int, default=25)
    return p.parse_args()


def timecode(s: str, fps: float) -> float:
    parts = [int(x) for x in re.split(r"[:;.]", s.strip())]
    if len(parts) != 4:
        raise ValueError(f"タイムコードを読めません: {s}")
    h, m, sec, f = parts
    return h * 3600 + m * 60 + sec + f / fps


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9']", "", text.lower())


def tokens(text: str) -> list[str]:
    return [t for t in (norm(x) for x in text.split()) if t]


def short_name(label: str | None) -> str | None:
    if not label:
        return None
    # "Robert Diament(ホスト)" → "Robert Diament"
    return re.split(r"[（(]", label)[0].strip() or label


def main() -> None:
    args = parse_args()
    doc = json.loads(args.transcript.read_text(encoding="utf-8"))
    bi = json.loads(args.bilingual.read_text(encoding="utf-8"))
    words: list[dict] = doc["words"]
    zero = timecode(args.timeline_start, args.fps)
    tc = lambda s: timecode(s, args.fps) - zero  # noqa: E731

    segs = sorted(bi.get("segments", []), key=lambda s: tc(s["start"]))
    if not segs:
        sys.exit("segments が見つかりません")
    seg_starts = [tc(s["start"]) for s in segs]

    # 発言ブロックの境目を決める。DaVinci と Whisper の時刻は 0.3 秒ほど食い違うことがあるので、
    # 指定時刻の近く（-2〜+1.5 秒）で、英文の最初・最後の数語が一致し、間が空いている切れ目を選ぶ
    owner = [0] * len(words)
    starts = [w["start"] for w in words]
    norm_words = [norm(w["text"]) for w in words]
    prev_b = 0
    bounds: list[tuple[int, int]] = []  # (最初の単語, ブロック番号)
    for k in range(1, len(segs)):
        t = seg_starts[k]
        lo = max(prev_b + 1, bisect.bisect_left(starts, t - 2.0))
        hi = bisect.bisect_right(starts, t + 1.5)
        head = tokens(segs[k]["en"])[:3]
        tail = tokens(segs[k - 1]["en"])[-3:]
        best, best_score = None, float("-inf")
        for b in range(lo, min(hi, len(words))):
            # 英文の「このブロックの最初の数語」「前のブロックの最後の数語」が一致するか
            score = sum(2.0 for x, y in zip(head, norm_words[b:b + 3]) if x == y)
            score += sum(1.0 for x, y in zip(reversed(tail), reversed(norm_words[max(0, b - 3):b])) if x == y)
            gap = words[b]["start"] - words[b - 1]["end"]
            score += gap * 2 - abs(words[b]["start"] - t) * 0.5
            if score > best_score:
                best, best_score = b, score
        if best is None:
            continue  # このブロックに当たる単語がない（音楽など）
        bounds.append((best, k))
        prev_b = best
    cur = 0
    edges = dict(bounds)
    for i in range(len(words)):
        if i in edges:
            cur = edges[i]
        owner[i] = cur

    speaker_names = {k: short_name(v) for k, v in (bi.get("speakers") or {}).items()}
    paragraphs = []
    seg_to_para: dict[int, int] = {}
    i = 0
    while i < len(words):
        k = owner[i]
        j = i
        while j + 1 < len(words) and owner[j + 1] == k:
            j += 1
        seg = segs[k]
        seg_to_para[seg["id"]] = len(paragraphs)
        paragraphs.append({
            "start": round(words[i]["start"], 3),
            "end": round(words[j]["end"], 3),
            "firstWord": i,
            "lastWord": j,
            "speaker": seg.get("speaker_id"),
            "ja": seg.get("ja") or None,
            "sourceId": seg.get("id"),
        })
        for x in range(i, j + 1):
            words[x]["speaker"] = seg.get("speaker_id")
        i = j + 1

    # 文を段落ごとに作り直す（段落の境目で必ず区切る）
    new_sentences = []
    for p in paragraphs:
        chunk = words[p["firstWord"]:p["lastWord"] + 1]
        for s in sentences.split_sentences(chunk, soft_max_words=args.soft_max_words):
            new_sentences.append({
                "start": round(s["start"], 3),
                "end": round(s["end"], 3),
                "firstWord": s["firstWord"] + p["firstWord"],
                "lastWord": s["lastWord"] + p["firstWord"],
                "speaker": p["speaker"],
            })

    topics = []
    for sec in bi.get("sections", []):
        ids = sec.get("segment_ids") or []
        paras = sorted(seg_to_para[x] for x in range(ids[0], ids[-1] + 1) if x in seg_to_para) if ids else []
        if not paras:
            print(f"  ⚠ 話題「{sec.get('title_en')}」に対応する単語がありませんでした（スキップ）")
            continue
        a, b = paragraphs[paras[0]], paragraphs[paras[-1]]
        topics.append({
            "titleEn": sec.get("title_en"),
            "titleJa": sec.get("title_ja"),
            "start": a["start"],
            "end": b["end"],
            "firstWord": a["firstWord"],
            "lastWord": b["lastWord"],
            "firstParagraph": paras[0],
            "lastParagraph": paras[-1],
        })

    used = sorted({p["speaker"] for p in paragraphs if p["speaker"]})
    doc["speakers"] = [{"id": s, "name": speaker_names.get(s) or s} for s in used]
    doc["sentences"] = new_sentences
    doc["paragraphs"] = paragraphs
    doc["topics"] = topics
    if bi.get("title"):
        doc["title"] = bi["title"]
    doc["annotations"] = {
        "source": args.bilingual.name,
        "addedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    backup = args.transcript.with_suffix(".json.bak")
    if not backup.exists():
        shutil.copy2(args.transcript, backup)
    args.transcript.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"取り込みました: 話題 {len(topics)} / 段落 {len(paragraphs)} / 文 {len(new_sentences)}")
    print(f"  {args.transcript}")
    print(f"  （元のファイルは {backup.name} に保存）")


if __name__ == "__main__":
    main()
