"""ffmpeg を使った音声の変換・デコード・同期チェック。"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "ffmpeg"
    if fallback.exists():
        return str(fallback)
    raise SystemExit(
        "ffmpeg が見つかりません。README の「ffmpeg のインストール」を参照してください。"
    )


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-2000:]
        raise SystemExit(f"ffmpeg の実行に失敗しました:\n{' '.join(cmd)}\n{tail}")


def decode_to_wav(ffmpeg: str, src: Path, dst: Path) -> None:
    """認識・比較用に 16kHz モノラル WAV にデコードする。"""
    _run([ffmpeg, "-nostdin", "-y", "-v", "error", "-i", str(src),
          "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dst)])


def encode_m4a(ffmpeg: str, src: Path, dst: Path, bitrate: str) -> None:
    """再生用の AAC (m4a) を作る。faststart で先頭に索引を置き、シークを速くする。"""
    _run([ffmpeg, "-nostdin", "-y", "-v", "error", "-i", str(src),
          "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", bitrate,
          "-movflags", "+faststart", str(dst)])


def read_wav(path: Path) -> np.ndarray:
    import wave
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class SyncCheck:
    method: str = "xcorr"
    offsets_ms: list[float] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)
    corrected: bool = False
    applied_offset_ms: float = 0.0

    def to_json(self) -> dict:
        return {
            "method": self.method,
            "offsetsMs": [round(x, 2) for x in self.offsets_ms],
            "confidences": [round(x, 3) for x in self.confidences],
            "corrected": self.corrected,
            "appliedOffsetMs": round(self.applied_offset_ms, 2),
        }


def _loudest_window_start(x: np.ndarray, lo: int, hi: int, win: int) -> int:
    """[lo, hi) の中で最も音量の大きい win 長の区間の開始位置（無音区間での比較を避ける）。"""
    hi = max(lo + 1, min(hi, len(x) - win))
    if hi <= lo:
        return max(0, min(lo, len(x) - win))
    step = SAMPLE_RATE // 2
    best, best_e = lo, -1.0
    for s in range(lo, hi, step):
        e = float(np.mean(x[s:s + win] ** 2))
        if e > best_e:
            best, best_e = s, e
    return best


def measure_offset(ref: np.ndarray, test: np.ndarray, *, window_s: float = 8.0,
                   search_s: float = 0.3) -> SyncCheck:
    """元音声(ref)と変換後(test)を冒頭・中盤・終盤の3か所で相互相関し、ずれを測る。

    正の値 = 変換後の音声が遅れている（同じ音が後ろの時刻に来る）。
    """
    check = SyncCheck()
    win = int(window_s * SAMPLE_RATE)
    pad = int(search_s * SAMPLE_RATE)
    n = min(len(ref), len(test))
    if n < win + 2 * pad:
        win = max(SAMPLE_RATE, n - 2 * pad - 1)
    if win <= 0 or n < win + 2 * pad:
        return check

    regions = [(0.05, 0.25), (0.40, 0.60), (0.75, 0.95)]
    for a, b in regions:
        s = _loudest_window_start(ref, max(pad, int(n * a)), int(n * b), win)
        s = min(max(s, pad), n - win - pad)
        seg = ref[s:s + win]
        look = test[s - pad:s + win + pad]
        size = 1 << int(np.ceil(np.log2(len(look) + len(seg))))
        corr = np.fft.irfft(np.fft.rfft(look, size) * np.conj(np.fft.rfft(seg, size)), size)
        corr = corr[: 2 * pad + 1]
        k = int(np.argmax(corr))
        denom = float(np.linalg.norm(seg) * np.linalg.norm(look[k:k + win])) or 1.0
        check.offsets_ms.append((k - pad) / SAMPLE_RATE * 1000.0)
        check.confidences.append(float(corr[k]) / denom)
    return check


def probe_duration(wav: np.ndarray) -> float:
    return len(wav) / SAMPLE_RATE


def temp_dir_for(out_dir: Path) -> Path:
    d = out_dir / ".make_transcript_tmp"
    d.mkdir(exist_ok=True)
    return d


def cleanup(d: Path) -> None:
    shutil.rmtree(d, ignore_errors=True)
