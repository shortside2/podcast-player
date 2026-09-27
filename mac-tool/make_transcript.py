#!/usr/bin/env python3
"""mp3 などの音声から、単語タイムスタンプ付きスクリプト JSON と再生用 m4a を作る。

    python make_transcript.py episode.mp3

出力（入力と同じフォルダ）:
    episode.json  … スクリプト（schemaVersion 1、docs/transcript-schema.md 参照）
    episode.m4a   … iPhone で再生する音声（AAC）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from transcript import asr, audio, sentences

TOOL_VERSION = "0.1.0"
SCHEMA_VERSION = 1
# 同期チェックでこれ以上ずれていたら、JSON の時刻を補正する
OFFSET_TOLERANCE_MS = 5.0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="音声 → 単語タイムスタンプ付き JSON + m4a")
    p.add_argument("audio", type=Path, help="入力音声（mp3 / m4a / wav など）")
    p.add_argument("--model", default=asr.DEFAULT_MODEL,
                   help=f"mlx-whisper のモデル（既定: {asr.DEFAULT_MODEL}）")
    p.add_argument("--language", default="en")
    p.add_argument("--align", choices=["none", "whisperx"], default="none",
                   help="whisperx を指定すると wav2vec2 で単語境界を補正する")
    p.add_argument("--diarize", action="store_true", help="話者分離（WhisperX + pyannote）")
    p.add_argument("--hf-token", default=os.environ.get("HF_TOKEN"),
                   help="話者分離用の Hugging Face トークン（環境変数 HF_TOKEN でも可）")
    p.add_argument("--out-dir", type=Path, default=None, help="出力先（既定: 入力と同じフォルダ）")
    p.add_argument("--bitrate", default="96k", help="m4a のビットレート（既定: 96k）")
    p.add_argument("--pause-break", type=float, default=1.0,
                   help="句読点がなくても文を区切る無音の長さ（秒、既定 1.0）")
    p.add_argument("--max-words", type=int, default=60, help="1文の最大単語数（既定 60）")
    p.add_argument("--soft-max-words", type=int, default=25,
                   help="これより長い文は、カンマや and/but/so の前などで分ける（既定 25）")
    p.add_argument("--resplit", action="store_true",
                   help="音声認識をやり直さず、既存の JSON の文の区切りだけを作り直す")
    p.add_argument("--title", default=None, help="エピソード名（既定: ファイル名）")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    src: Path = args.audio.expanduser().resolve()
    if not src.exists():
        sys.exit(f"ファイルが見つかりません: {src}")
    if args.diarize and args.align != "whisperx":
        args.align = "whisperx"  # 話者分離は WhisperX 経由で行う

    out_dir = (args.out_dir or src.parent).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / f"{src.stem}.json"
    out_m4a = out_dir / f"{src.stem}.m4a"
    if out_m4a == src:
        sys.exit("入力が m4a で、出力と同じファイル名になります。--out-dir で別のフォルダを指定してください。")

    if args.resplit:
        resplit(args, out_json)
        return

    ffmpeg = audio.find_ffmpeg()
    tmp = audio.temp_dir_for(out_dir)
    t0 = time.time()
    try:
        print(f"[1/5] 音声をデコード中: {src.name}", flush=True)
        src_wav = tmp / "source.wav"
        audio.decode_to_wav(ffmpeg, src, src_wav)
        ref = audio.read_wav(src_wav)
        duration = audio.probe_duration(ref)
        print(f"      長さ {duration / 60:.1f} 分", flush=True)

        print(f"[2/5] m4a に変換中（AAC {args.bitrate}）", flush=True)
        audio.encode_m4a(ffmpeg, src, out_m4a, args.bitrate)

        print("[3/5] 変換後の音声とタイムスタンプの一致を確認中", flush=True)
        m4a_wav = tmp / "m4a.wav"
        audio.decode_to_wav(ffmpeg, out_m4a, m4a_wav)
        sync = audio.measure_offset(ref, audio.read_wav(m4a_wav))
        reliable = [o for o, c in zip(sync.offsets_ms, sync.confidences) if c >= 0.5]
        offset_ms = sorted(reliable)[len(reliable) // 2] if reliable else 0.0
        print(f"      ずれ: {', '.join(f'{o:+.1f}ms' for o in sync.offsets_ms)}"
              f"（一致度 {', '.join(f'{c:.2f}' for c in sync.confidences)}）", flush=True)
        if not reliable:
            print("      ⚠ 比較できる区間が見つからず、一致を確認できませんでした。", flush=True)
        elif abs(offset_ms) > OFFSET_TOLERANCE_MS:
            sync.corrected = True
            sync.applied_offset_ms = offset_ms
            print(f"      ⚠ {offset_ms:+.1f}ms ずれているため、JSON の時刻を補正します。", flush=True)
        else:
            print("      ✓ 一致しています", flush=True)

        print(f"[4/5] 音声認識中（{args.model}）… 1時間の音声で数分かかります", flush=True)
        raw = asr.transcribe_mlx(src_wav, args.model, args.language)
        aligner = None
        if args.align == "whisperx":
            raw = sentences.clean_words(raw, duration)
            raw = asr.align_whisperx(src_wav, raw, args.language, args.diarize, args.hf_token)
            aligner = "whisperx"

        words = sentences.clean_words(raw, duration)
        shift = sync.applied_offset_ms / 1000.0
        for w in words:
            w["start"] += shift
            w["end"] += shift

        print("[5/5] 文に分割して JSON を書き出し中", flush=True)
        sents = sentences.split_sentences(words, pause_break=args.pause_break,
                                          max_words=args.max_words,
                                          soft_max_words=args.soft_max_words)
        doc = build_document(args, src, out_m4a, duration, words, sents, sync, aligner)
        out_json.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    finally:
        audio.cleanup(tmp)

    elapsed = time.time() - t0
    print(f"\n完了（{elapsed / 60:.1f} 分）: {len(words)} 単語 / {len(sents)} 文")
    print(f"  {out_json}")
    print(f"  {out_m4a}")


def resplit(args, out_json: Path) -> None:
    if not out_json.exists():
        sys.exit(f"JSON が見つかりません: {out_json}")
    doc = json.loads(out_json.read_text(encoding="utf-8"))
    sents = sentences.split_sentences(doc["words"], pause_break=args.pause_break,
                                      max_words=args.max_words,
                                      soft_max_words=args.soft_max_words)
    doc["sentences"] = [{**s, "start": r3(s["start"]), "end": r3(s["end"])} for s in sents]
    out_json.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"文の区切りを作り直しました: {len(sents)} 文\n  {out_json}")


def r3(x: float) -> float:
    return round(float(x), 3)


def build_document(args, src: Path, m4a: Path, duration: float, words: list[dict],
                   sents: list[dict], sync: audio.SyncCheck, aligner: str | None) -> dict:
    speaker_ids = sorted({w["speaker"] for w in words if w.get("speaker")})
    return {
        "schemaVersion": SCHEMA_VERSION,
        "title": args.title or src.stem,
        "generator": {
            "tool": "make_transcript",
            "version": TOOL_VERSION,
            "engine": "mlx-whisper",
            "model": args.model,
            "aligner": aligner,
            "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "audio": {
            "fileName": m4a.name,
            "duration": r3(duration),
            "sha256": audio.sha256_file(m4a),
            "source": {"fileName": src.name, "sha256": audio.sha256_file(src)},
            "syncCheck": sync.to_json(),
        },
        "language": args.language,
        "speakers": [{"id": s, "name": None} for s in speaker_ids],
        "words": [{
            "text": w["text"],
            "start": r3(w["start"]),
            "end": r3(w["end"]),
            "speaker": w.get("speaker"),
            "confidence": None if w.get("confidence") is None else round(float(w["confidence"]), 3),
        } for w in words],
        "sentences": [{**s, "start": r3(s["start"]), "end": r3(s["end"])} for s in sents],
        "revision": {"source": "asr", "editedAt": None},
    }


if __name__ == "__main__":
    main()
