#!/usr/bin/env python3
"""mp3 から ListenLoop 用の素材（スクリプト JSON + m4a、話者・段落・話題・日本語訳つき）を一括で作る。

Claude（podcast-prep スキル）と組み合わせて使う。スクリプトが機械的な部分を、Claude が
「話者・段落・話題の判断」と「日本語訳」を担当する。

    1) python podcast_prep.py start  episode.mp3   文字起こし（ローカル）→ 作業フォルダに outline.txt
       （Claude が outline.txt を読んで work/structure.json を書く）
    2) python podcast_prep.py chunks episode.mp3   structure.json を確認 → 翻訳用に chunk_XX.txt を作る
       （Claude が各 chunk_XX.txt を訳して chunk_XX.ja.json を書く）
    3) python podcast_prep.py finish episode.mp3   すべてを合体して episode.json を完成 → iCloud Drive にコピー

作業フォルダ: mp3 と同じ場所の「<名前>_work/」
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from transcript import audio

HERE = Path(__file__).resolve().parent
ICLOUD_DIR = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs" / "ListenLoop"
CHUNK_WORDS = 1500


def paths(mp3: Path) -> dict[str, Path]:
    mp3 = mp3.expanduser().resolve()
    work = mp3.parent / f"{mp3.stem}_work"
    return {
        "mp3": mp3,
        "json": mp3.with_suffix(".json"),
        "m4a": mp3.with_suffix(".m4a"),
        "work": work,
        "outline": work / "outline.txt",
        "structure": work / "structure.json",
    }


def fmt(t: float) -> str:
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def sentence_text(doc: dict, s: dict) -> str:
    return " ".join(w["text"] for w in doc["words"][s["firstWord"]:s["lastWord"] + 1])


# ---------------------------------------------------------------- start
def cmd_start(args: argparse.Namespace) -> None:
    p = paths(args.mp3)
    if not p["mp3"].exists():
        sys.exit(f"ファイルが見つかりません: {p['mp3']}")

    need = True
    if p["json"].exists() and p["m4a"].exists() and not args.force:
        doc = load(p["json"])
        src = (doc.get("audio") or {}).get("source") or {}
        if src.get("sha256") == audio.sha256_file(p["mp3"]) and doc.get("words"):
            need = False
            print(f"文字起こし済みのため再利用します: {p['json'].name}")
    if need:
        cmd = [sys.executable, str(HERE / "make_transcript.py"), str(p["mp3"])]
        if args.title:
            cmd += ["--title", args.title]
        print("文字起こし中（1 時間の音声で 4 分ほど）…", flush=True)
        subprocess.run(cmd, check=True)

    doc = load(p["json"])
    p["work"].mkdir(exist_ok=True)
    lines = [
        f"# title: {doc.get('title')}",
        f"# duration: {fmt(doc['audio']['duration'])}  sentences: {len(doc['sentences'])}  words: {len(doc['words'])}",
        "# 各行: S<文番号> [時刻] 英文（自動文字起こし。聞き取り誤りを含む）",
        "",
    ]
    for i, s in enumerate(doc["sentences"]):
        lines.append(f"S{i} [{fmt(s['start'])}] {sentence_text(doc, s)}")
    p["outline"].write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nOK start: {len(doc['sentences'])} 文 / {len(doc['words'])} 語 / {fmt(doc['audio']['duration'])}")
    print(f"  outline:   {p['outline']}")
    print(f"  次に書く:  {p['structure']}")


# ---------------------------------------------------------------- structure の検査
def validate_structure(doc: dict, st: dict) -> list[str]:
    errs: list[str] = []
    n = len(doc["sentences"])
    segs = st.get("segments") or []
    speakers = st.get("speakers") or {}
    if not segs:
        return ["segments が空です"]
    ids = [s.get("id") for s in segs]
    if len(set(ids)) != len(ids):
        errs.append("segments の id が重複しています")
    expect = 0
    for s in segs:
        a, b = s.get("first"), s.get("last")
        if not isinstance(a, int) or not isinstance(b, int) or a > b:
            errs.append(f"segment {s.get('id')}: first/last が不正です（{a}, {b}）")
            continue
        if a != expect:
            errs.append(f"segment {s.get('id')}: S{expect} から始まるはずが S{a} から始まっています（抜け・重なり）")
        expect = b + 1
        if s.get("speaker") not in speakers:
            errs.append(f"segment {s.get('id')}: speaker「{s.get('speaker')}」が speakers にありません")
    if expect != n:
        errs.append(f"最後の segment が S{expect - 1} で終わっています（S{n - 1} まで必要）")
    valid = set(ids)
    for t in st.get("topics") or []:
        if t.get("first_segment") not in valid or t.get("last_segment") not in valid:
            errs.append(f"topic「{t.get('title_en')}」の first_segment / last_segment が segments にありません")
    return errs


# ---------------------------------------------------------------- chunks
def cmd_chunks(args: argparse.Namespace) -> None:
    p = paths(args.mp3)
    doc = load(p["json"])
    if not p["structure"].exists():
        sys.exit(f"structure.json がありません: {p['structure']}")
    st = load(p["structure"])
    errs = validate_structure(doc, st)
    if errs:
        print("structure.json を直してください:")
        for e in errs[:30]:
            print("  -", e)
        sys.exit(1)

    for old in p["work"].glob("chunk_*.txt"):
        old.unlink()
    chunks: list[list[str]] = [[]]
    count = 0
    for s in st["segments"]:
        # 訳を英文 1 文ごとに対応させるため、段落の中の文を 1 行ずつ並べる
        lines = [f"#{s['id']} {s['speaker']}"]
        words = 0
        for i in range(s["first"], s["last"] + 1):
            t = sentence_text(doc, doc["sentences"][i])
            lines.append(f"S{i} {t}")
            words += len(t.split())
        if chunks[-1] and count + words > CHUNK_WORDS:
            chunks.append([])
            count = 0
        chunks[-1].append("\n".join(lines))
        count += words
    names = []
    for k, lines in enumerate(chunks, 1):
        f = p["work"] / f"chunk_{k:02d}.txt"
        f.write_text("\n\n".join(lines) + "\n", encoding="utf-8")
        names.append(f.name)
    print(f"OK chunks: {len(st['segments'])} 段落 / 話題 {len(st.get('topics') or [])} / 翻訳ファイル {len(names)} 個")
    for nm in names:
        print(f"  {p['work'] / nm}  →  {nm.replace('.txt', '.ja.json')}")


# ---------------------------------------------------------------- finish
def short_name(label: str | None) -> str | None:
    if not label:
        return None
    return re.split(r"[（(]", label)[0].strip() or label


def cmd_finish(args: argparse.Namespace) -> None:
    p = paths(args.mp3)
    doc = load(p["json"])
    st = load(p["structure"])
    errs = validate_structure(doc, st)
    if errs:
        sys.exit("structure.json に問題があります。chunks を実行して確認してください。")

    # 訳: 段落 id → [{"s": [最初の文, 最後の文], "ja": 訳}, ...]（古い形式の「段落 id → 訳の文字列」も読める）
    raw: dict[int, object] = {}
    for f in sorted(p["work"].glob("chunk_*.ja.json")):
        try:
            for k, v in load(f).items():
                raw[int(k)] = v
        except (ValueError, json.JSONDecodeError) as e:
            sys.exit(f"{f.name} を読めません: {e}")
    ja: dict[int, str] = {}
    ja_units: dict[int, list[dict]] = {}
    problems: list[str] = []
    for seg in st["segments"]:
        v = raw.get(seg["id"])
        if v is None:
            continue
        if isinstance(v, str):
            ja[seg["id"]] = v.strip()
            continue
        units, expect = [], seg["first"]
        for u in v if isinstance(v, list) else []:
            rng = u.get("s")
            a, b = (rng, rng) if isinstance(rng, int) else (rng[0], rng[-1]) if isinstance(rng, list) and rng else (None, None)
            text = str(u.get("ja", "")).strip()
            if a is None or a != expect or b < a or b > seg["last"] or not text:
                problems.append(f"段落 {seg['id']}: S{expect} から順に、抜け・重なりなく訳を対応させてください（{rng} のところ）")
                break
            units.append({"firstSentence": a, "lastSentence": b, "text": text})
            expect = b + 1
        else:
            if expect != seg["last"] + 1:
                problems.append(f"段落 {seg['id']}: S{expect}〜S{seg['last']} の訳がありません")
        if units:
            ja_units[seg["id"]] = units
            ja[seg["id"]] = "".join(u["text"] for u in units)
    missing = [s["id"] for s in st["segments"] if not ja.get(s["id"])]
    if (missing or problems) and not args.allow_missing:
        if missing:
            print(f"訳がない段落があります（{len(missing)} 個）: {missing[:40]}")
        for pr in problems[:30]:
            print("  -", pr)
        print("対応する chunk_XX.ja.json を直すか、--allow-missing を付けて実行してください。")
        sys.exit(1)

    words, sents = doc["words"], doc["sentences"]
    paragraphs, seg_to_para = [], {}
    for s in st["segments"]:
        a, b = sents[s["first"]]["firstWord"], sents[s["last"]]["lastWord"]
        for i in range(a, b + 1):
            words[i]["speaker"] = s["speaker"]
        for i in range(s["first"], s["last"] + 1):
            sents[i]["speaker"] = s["speaker"]
        seg_to_para[s["id"]] = len(paragraphs)
        paragraphs.append({
            "start": round(words[a]["start"], 3), "end": round(words[b]["end"], 3),
            "firstWord": a, "lastWord": b, "speaker": s["speaker"],
            "ja": ja.get(s["id"]) or None, "sourceId": s["id"],
            # 英文の文ごとの訳（アプリで、今の文に対応する訳だけを強調するのに使う）
            **({"jaSentences": ja_units[s["id"]]} if s["id"] in ja_units else {}),
        })
    topics = []
    for t in st.get("topics") or []:
        pa, pb = seg_to_para[t["first_segment"]], seg_to_para[t["last_segment"]]
        A, B = paragraphs[pa], paragraphs[pb]
        topics.append({
            "titleEn": t.get("title_en"), "titleJa": t.get("title_ja"),
            "start": A["start"], "end": B["end"], "firstWord": A["firstWord"], "lastWord": B["lastWord"],
            "firstParagraph": pa, "lastParagraph": pb,
        })
    used = sorted({x["speaker"] for x in paragraphs})
    doc["speakers"] = [{"id": s, "name": short_name(st["speakers"].get(s)) or s} for s in used]
    doc["paragraphs"] = paragraphs
    doc["topics"] = topics
    if st.get("title"):
        doc["title"] = st["title"]
    doc["annotations"] = {"source": "podcast-prep", "addedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    p["json"].write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK finish: 話題 {len(topics)} / 段落 {len(paragraphs)} / 訳あり {sum(1 for x in paragraphs if x['ja'])}"
          f"（文ごとの訳 {sum(len(x.get('jaSentences') or []) for x in paragraphs)} 個）")
    print(f"  {p['json']}")
    print(f"  {p['m4a']}")

    if not args.no_icloud:
        if ICLOUD_DIR.parent.exists():
            ICLOUD_DIR.mkdir(exist_ok=True)
            for f in (p["json"], p["m4a"]):
                shutil.copy2(f, ICLOUD_DIR / f.name)
            print(f"  iCloud Drive にコピーしました: iCloud Drive › ListenLoop › {p['json'].name} / {p['m4a'].name}")
        else:
            print("  （iCloud Drive が見つからないためコピーしていません）")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("start", help="文字起こし → outline.txt")
    a.add_argument("mp3", type=Path)
    a.add_argument("--title")
    a.add_argument("--force", action="store_true", help="文字起こしをやり直す")
    a.set_defaults(fn=cmd_start)
    b = sub.add_parser("chunks", help="structure.json を検査して翻訳用ファイルを作る")
    b.add_argument("mp3", type=Path)
    b.set_defaults(fn=cmd_chunks)
    c = sub.add_parser("finish", help="合体して完成 → iCloud Drive へ")
    c.add_argument("mp3", type=Path)
    c.add_argument("--allow-missing", action="store_true", help="訳のない段落があっても完成させる")
    c.add_argument("--no-icloud", action="store_true", help="iCloud Drive にコピーしない")
    c.set_defaults(fn=cmd_finish)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
