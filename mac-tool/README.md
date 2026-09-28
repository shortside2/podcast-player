# make_transcript（Mac 側ツール）

> **おすすめ：Claude Code の podcast-prep スキルで一括処理**
> Claude Code で「`~/…/episode.mp3` を ListenLoop の素材にして」と頼むと、
> 文字起こし → 話者・段落・話題分け → 日本語訳 → 合体 → iCloud Drive › ListenLoop へのコピーまで自動で行います
> （スキル本体: `~/.claude/skills/podcast-prep/SKILL.md`、処理の本体: `podcast_prep.py`）。
> 以下は各ツールを個別に使う場合の説明です。

ポッドキャストの音声から、次の 2 つを作ります。

| 出力 | 中身 |
|---|---|
| `episode.json` | 単語ごとの開始・終了時刻つきスクリプト（仕様: [../docs/transcript-schema.md](../docs/transcript-schema.md)） |
| `episode.m4a` | iPhone で再生する音声（AAC）。Safari では mp3 だと再生位置の移動がずれやすいため変換する |

変換後の m4a が元の音声と時刻がずれていないかも、自動で確認します（ずれていたら JSON の時刻を補正）。

## 必要なもの

- Apple Silicon の Mac
- ffmpeg（このMacには `~/.local/bin/ffmpeg` がすでにあります）
- Python 3.12（下の手順で入れます）

## セットアップ（最初の 1 回だけ）

ターミナルで順番に実行してください。

1. **uv（Python のバージョン管理ツール）を入れる**（このMacには導入済み）

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **このフォルダに移動**

   ```bash
   cd ~/"Documents/Claude Code/podcast-player/mac-tool"
   ```

3. **Python 3.12 の仮想環境（このツール専用の Python）を作る**

   ```bash
   ~/.local/bin/uv venv --python 3.12 .venv
   ```

4. **必要なライブラリを入れる**

   ```bash
   ~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt
   ```

初回の実行時に、認識モデル（large-v3、約 3GB）を自動でダウンロードします。

### ffmpeg が無い場合

`ffmpeg -version` がエラーになる場合は、[evermeet.cx](https://evermeet.cx/ffmpeg/) などから Apple Silicon 用の ffmpeg をダウンロードし、`~/.local/bin/` に置いてください。

## 使い方

```bash
cd ~/"Documents/Claude Code/podcast-player/mac-tool"
.venv/bin/python make_transcript.py ~/Downloads/episode.mp3
```

同じフォルダに `episode.json` と `episode.m4a` ができます。この 2 つを iPhone に送って（AirDrop なら「ファイル」アプリに保存）、アプリの「取り込む」から 2 つ同時に選んでください。

処理時間の目安（M4 Max・large-v3）: 1 時間の音声で数分〜10 分程度。

### オプション

| オプション | 説明 |
|---|---|
| `--title "Ep 12: ..."` | アプリに表示するエピソード名（既定はファイル名） |
| `--model mlx-community/whisper-large-v3-turbo` | 速いモデルに切り替え（精度は少し下がる） |
| `--align whisperx` | WhisperX（wav2vec2）で単語の境界を補正する。ハイライトのタイミングをより正確にしたいとき |
| `--diarize --hf-token hf_xxx` | 話者分離（誰が話しているか）。Hugging Face のトークンが必要 |
| `--pause-break 1.0` | 句読点がなくても、この秒数以上の無音で文を区切る |
| `--max-words 60` | 1 文の最大単語数。超えたらカンマで分ける |
| `--soft-max-words 25` | これより長い文は、カンマや and / but / so などの前で分ける（会話は句読点が少なく、1文が長くなりがちなため） |
| `--resplit` | 音声認識をやり直さず、既存の JSON の文の区切りだけ作り直す（数秒で終わる） |
| `--bitrate 96k` | m4a の音質 |
| `--out-dir 出力先` | 出力フォルダ |

### WhisperX（任意）

依存ライブラリが大きい（PyTorch など数 GB）ため、必要になったときだけ入れてください。

```bash
~/.local/bin/uv pip install --python .venv/bin/python -r requirements-whisperx.txt
```

話者分離を使う場合は、Hugging Face のアカウントを作り、`pyannote/speaker-diarization-3.1` の利用規約に同意してからトークンを発行してください。

## 文の区切り方

次のどれかに当てはまったら文を区切ります。

1. 単語が `. ? ! …` で終わる（`Mr.` `Dr.` などの略語は除く）
2. 次の単語までの無音が `--pause-break` 秒以上
3. 話者が変わる（話者分離をしたとき）
4. 単語数が `--max-words` を超えた（後半にあるカンマで分割）
5. `--soft-max-words` を超える文は、カンマ・無音・and / but / so などの前のうち、真ん中に近い自然な位置で分割

## 話題・段落・日本語訳を取り込む（add_bilingual.py）

チャットで作った「話題（sections）・発言ブロック（segments）・日本語訳」の JSON を、スクリプト JSON に取り込みます。

```bash
cd ~/"Documents/Claude Code/podcast-player/mac-tool"
.venv/bin/python add_bilingual.py "…/episode.json" "…/episode_bilingual.json"
```

- 発言ブロックが段落になり、話者名と日本語訳が付きます（アプリの「訳」ボタンで表示）
- 話題が見出しになり、アプリで見出しをタップするとその話題が区間になります
- 元のスクリプトは `episode.json.bak` に 1 度だけ保存してから上書きします
- 時刻は DaVinci のタイムコード（`01:00:00;00` を 0 秒）で対応付け、境目は英文の最初と最後の数語でそろえます

更新した `.json` は、アプリの「取り込む」で **.json だけ**を選べば、取り込み済みのエピソードに反映されます（マーク・範囲はそのまま）。

bilingual JSON の形（必要な項目）:

```json
{
  "title": "Talk Art — Lewis Hammond",
  "speakers": { "robert": "Robert Diament(ホスト)", "lewis": "Lewis Hammond(ゲスト)" },
  "sections": [ { "id": 1, "title_en": "Introduction", "title_ja": "イントロダクション", "segment_ids": [7, 9] } ],
  "segments": [ { "id": 7, "start": "01:01:19;12", "end": "01:03:29;27", "speaker_id": "robert", "en": "…", "ja": "…" } ]
}
```

## 一括処理（podcast_prep.py）

podcast-prep スキルが内部で使うスクリプトです。手で動かす場合:

```bash
cd ~/"Documents/Claude Code/podcast-player/mac-tool"
.venv/bin/python podcast_prep.py start  "…/episode.mp3"   # 文字起こし → episode_work/outline.txt
# （episode_work/structure.json を書く: 話者・段落・話題）
.venv/bin/python podcast_prep.py chunks "…/episode.mp3"   # 検査 → 翻訳用 chunk_XX.txt
# （chunk_XX.ja.json を書く: 段落ごとの日本語訳）
.venv/bin/python podcast_prep.py finish "…/episode.mp3"   # 合体 → episode.json 完成 → iCloud Drive › ListenLoop にコピー
```
