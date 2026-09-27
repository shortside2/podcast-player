"""音声認識（mlx-whisper）と、任意の WhisperX アライメント・話者分離。

どの経路でも、最終的に次の形の単語リストを返す:
    {"text": str, "start": float, "end": float, "confidence": float|None, "speaker": str|None}
"""
from __future__ import annotations

import inspect
from pathlib import Path

DEFAULT_MODEL = "mlx-community/whisper-large-v3-mlx"


def transcribe_mlx(wav: Path, model: str, language: str) -> list[dict]:
    try:
        import mlx_whisper
    except ImportError:
        raise SystemExit("mlx-whisper が入っていません。README のセットアップ手順を実行してください。")

    kwargs = dict(
        path_or_hf_repo=model,
        word_timestamps=True,
        language=language,
        # 長い音声で同じ文を繰り返し出力する現象を防ぐ
        condition_on_previous_text=False,
        verbose=None,
    )
    params = inspect.signature(mlx_whisper.transcribe).parameters
    if "hallucination_silence_threshold" in params:
        kwargs["hallucination_silence_threshold"] = 2.0
    result = mlx_whisper.transcribe(str(wav), **kwargs)

    words: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []) or []:
            words.append({
                "text": w.get("word", ""),
                "start": w.get("start"),
                "end": w.get("end"),
                "confidence": w.get("probability"),
                "speaker": None,
            })
    return words


def _segments_from_words(words: list[dict], max_gap: float = 1.0, max_len: float = 20.0) -> list[dict]:
    """WhisperX に渡すため、単語を適度な長さの区間にまとめ直す。"""
    segs: list[dict] = []
    cur: list[dict] = []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > max_gap or w["end"] - cur[0]["start"] > max_len):
            segs.append(cur)
            cur = []
        cur.append(w)
    if cur:
        segs.append(cur)
    return [{
        "start": s[0]["start"], "end": s[-1]["end"],
        "text": " ".join(x["text"].strip() for x in s),
    } for s in segs]


def align_whisperx(wav: Path, words: list[dict], language: str,
                   diarize: bool, hf_token: str | None) -> list[dict]:
    try:
        import whisperx
    except ImportError:
        raise SystemExit(
            "WhisperX が入っていません。README の「WhisperX（任意）」の手順で "
            "requirements-whisperx.txt をインストールしてください。")

    device = "cpu"
    audio = whisperx.load_audio(str(wav))
    segments = _segments_from_words(words)
    print(f"  WhisperX: アライメントモデルを読み込み中（{len(segments)} 区間）…", flush=True)
    model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
    aligned = whisperx.align(segments, model_a, metadata, audio, device,
                             return_char_alignments=False)

    if diarize:
        aligned = _diarize(whisperx, audio, aligned, hf_token, device)

    out: list[dict] = []
    for seg in aligned.get("segments", []):
        for w in seg.get("words", []):
            out.append({
                "text": w.get("word", ""),
                "start": w.get("start"),
                "end": w.get("end"),
                "confidence": w.get("score"),
                "speaker": w.get("speaker"),
            })
    return out


def _diarize(whisperx, audio, aligned: dict, hf_token: str | None, device: str) -> dict:
    if not hf_token:
        raise SystemExit("話者分離には Hugging Face のトークンが必要です（--hf-token または環境変数 HF_TOKEN）。")
    print("  話者分離を実行中…", flush=True)
    Pipeline = getattr(whisperx, "DiarizationPipeline", None)
    if Pipeline is None:
        from whisperx.diarize import DiarizationPipeline as Pipeline  # 新しい版
    try:
        pipe = Pipeline(use_auth_token=hf_token, device=device)
    except TypeError:
        pipe = Pipeline(token=hf_token, device=device)
    diar = pipe(audio)
    return whisperx.assign_word_speakers(diar, aligned)
