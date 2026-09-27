# スクリプト JSON 仕様（schemaVersion 1）

Mac 側ツール `make_transcript.py` が出力し、Web アプリが読み込むファイルの形式です。

```json
{
  "schemaVersion": 1,
  "title": "episode",
  "generator": {
    "tool": "make_transcript", "version": "0.1.0",
    "engine": "mlx-whisper", "model": "mlx-community/whisper-large-v3-mlx",
    "aligner": null, "createdAt": "2026-09-27T11:09:54+00:00"
  },
  "audio": {
    "fileName": "episode.m4a",
    "duration": 3612.48,
    "sha256": "…m4a のハッシュ…",
    "source": { "fileName": "episode.mp3", "sha256": "…" },
    "syncCheck": {
      "method": "xcorr", "offsetsMs": [0.0, 0.0, 0.0], "confidences": [1.0, 1.0, 1.0],
      "corrected": false, "appliedOffsetMs": 0.0
    }
  },
  "language": "en",
  "speakers": [ { "id": "SPEAKER_00", "name": null } ],
  "words": [
    { "text": "Right,", "start": 0.52, "end": 0.81, "speaker": null, "confidence": 0.93 }
  ],
  "sentences": [
    { "start": 0.52, "end": 3.10, "firstWord": 0, "lastWord": 11, "speaker": null }
  ],
  "revision": { "source": "asr", "editedAt": null }
}
```

## 項目

| 項目 | 説明 |
|---|---|
| `schemaVersion` | 形式のバージョン。互換性のない変更をしたら上げる。アプリは対応しているバージョンだけ読み込む |
| `title` | エピソード名（アプリの初期表示名） |
| `audio.sha256` | 再生用音声（m4a）の SHA-256。アプリは取り込み時に照合し、別の音声との組み合わせを防ぐ。バックアップの復元でもエピソードの識別に使う |
| `audio.syncCheck` | 変換後の音声と元音声のずれの実測値。`corrected: true` なら `appliedOffsetMs` だけ時刻を補正済み |
| `words[].text` | 表示する文字列（句読点を含む）。表示時は単語をスペースでつなぐ |
| `words[].start/end` | 秒（小数第 3 位まで）。**m4a の時刻**に合わせてある |
| `words[].speaker` | 話者 ID。話者分離をしていなければ `null` |
| `words[].confidence` | 認識の確からしさ（0〜1）。不明なら `null` |
| `sentences[].firstWord/lastWord` | その文に含まれる単語の番号（`words` の添字、両端を含む） |
| `revision.source` | `asr`（自動認識のまま）/ `edited`（手で修正済み） |

## 将来の拡張（DaVinci Resolve で修正したテキストの取り込み）

- 修正版は `revision.source = "edited"`、`revision.editedAt` に日時を入れる
- 単語の数や番号が変わっても困らないよう、アプリ側のマーク・範囲・録音は**時刻（秒）**を正本として保存している。スクリプトを差し替えたら、時刻から単語番号を計算し直す
- 項目の追加だけなら `schemaVersion` は 1 のままでよい。既存項目の意味を変える場合は 2 に上げ、アプリに変換処理を足す
