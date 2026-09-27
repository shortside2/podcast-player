"""単語リストの整形と、文への分割。"""
from __future__ import annotations

import re

# 文末とみなさない略語（イギリス英語で頻出のものを中心に）
ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "mt.", "vs.", "etc.", "e.g.", "i.e.",
    "approx.", "no.", "jr.", "sr.", "co.", "ltd.", "inc.", "u.k.", "u.s.",
}
_TRAILING_QUOTES = "\"'”’)]"
_TERMINAL = re.compile(r"[.?!…]$")


def clean_words(raw: list[dict], duration: float) -> list[dict]:
    """空文字を除き、時刻の欠けを補い、時刻が単調増加になるよう整える。"""
    words: list[dict] = []
    for w in raw:
        raw_text = w.get("text") or ""
        text = raw_text.strip()
        if not text:
            continue
        # Whisper は「fry-up」を " fry" + "-up" のように分けることがある。
        # 先頭に空白がなく記号で始まるトークンは、直前の単語の続きとしてつなげる
        if words and raw_text[:1] not in (" ", "") and not text[0].isalnum():
            prev = words[-1]
            prev["text"] += text
            if w.get("end") is not None:
                prev["end"] = w["end"]
            continue
        words.append({**w, "text": text})

    # 時刻が欠けている単語（数字など）は前後から補間する
    n = len(words)
    for i, w in enumerate(words):
        if w.get("start") is None or w.get("end") is None:
            prev_end = next((words[j]["end"] for j in range(i - 1, -1, -1)
                             if words[j].get("end") is not None), 0.0)
            next_start = next((words[j]["start"] for j in range(i + 1, n)
                               if words[j].get("start") is not None), prev_end)
            w["start"] = prev_end if w.get("start") is None else w["start"]
            w["end"] = max(w["start"], next_start) if w.get("end") is None else w["end"]

    last = 0.0
    for w in words:
        s = min(max(float(w["start"]), last), duration)
        e = min(max(float(w["end"]), s), duration)
        w["start"], w["end"] = s, e
        last = s
    return words


def _is_sentence_end(text: str) -> bool:
    t = text.rstrip(_TRAILING_QUOTES)
    if not _TERMINAL.search(t):
        return False
    return t.lower() not in ABBREVIATIONS


def split_sentences(words: list[dict], *, pause_break: float = 1.0,
                    min_gap_after_punct: float = 0.0, max_words: int = 60,
                    soft_max_words: int = 25) -> list[dict]:
    """文に分割したあと、soft_max_words を超える長い文をさらに自然な位置で分ける。"""
    base = _split_basic(words, pause_break=pause_break,
                        min_gap_after_punct=min_gap_after_punct, max_words=max_words)
    out: list[dict] = []
    for sent in base:
        for a, b in _split_long(words, sent["firstWord"], sent["lastWord"], soft_max_words):
            out.append({
                "start": words[a]["start"], "end": words[b]["end"],
                "firstWord": a, "lastWord": b, "speaker": sent["speaker"],
            })
    return out


# 会話では句読点が少ないため、長い文はこうした語の前でも区切る
_BREAK_BEFORE = {"and", "but", "so", "because", "cause", "which", "yeah", "then",
                 "or", "when", "where", "if", "though", "although", "i", "you", "we"}
_MIN_PIECE = 6


def _split_long(words: list[dict], a: int, b: int, limit: int) -> list[tuple[int, int]]:
    """[a, b] が limit 語を超えていたら、最も自然な区切りで2つに分けることを繰り返す。"""
    n = b - a + 1
    if n <= limit:
        return [(a, b)]
    mid = (a + b) / 2
    best, best_score = None, float("-inf")
    for i in range(a + _MIN_PIECE - 1, b - _MIN_PIECE + 1):  # i = 前半の最後の単語
        text = words[i]["text"]
        nxt = words[i + 1]["text"].lower().strip("\"'“‘,.")
        gap = words[i + 1]["start"] - words[i]["end"]
        score = 0.0
        if text.endswith((",", ";", ":", "—", "–")):
            score += 3
        if nxt in _BREAK_BEFORE:
            score += 2
        score += min(gap, 1.0) * 6  # 0.2 秒の間 ≒ +1.2
        score -= abs(i - mid) / n * 3  # 真ん中に近いほど良い
        if score > best_score:
            best, best_score = i, score
    if best is None:
        return [(a, b)]
    return _split_long(words, a, best, limit) + _split_long(words, best + 1, b, limit)


def _split_basic(words: list[dict], *, pause_break: float, min_gap_after_punct: float,
                 max_words: int) -> list[dict]:
    """句読点と無音の長さから文を区切る。

    - 文末記号（. ? ! …）で終わり、次の単語までの無音が min_gap_after_punct 以上 → 文末
    - 句読点がなくても無音が pause_break 以上 → 文末
    - 話者が変わる → 文末
    - max_words を超えたら、後半にある直近のカンマで分割
    """
    sentences: list[dict] = []
    first = 0
    n = len(words)

    def close(last: int) -> None:
        nonlocal first
        if last < first:
            return
        sentences.append({
            "start": words[first]["start"],
            "end": words[last]["end"],
            "firstWord": first,
            "lastWord": last,
            "speaker": words[first].get("speaker"),
        })
        first = last + 1

    for i in range(n):
        w = words[i]
        nxt = words[i + 1] if i + 1 < n else None
        if nxt is None:
            close(i)
            break
        gap = nxt["start"] - w["end"]
        if (_is_sentence_end(w["text"]) and gap >= min_gap_after_punct) \
                or gap >= pause_break \
                or (nxt.get("speaker") != w.get("speaker")):
            close(i)
            continue
        if i - first + 1 >= max_words:
            cut = i
            for j in range(i, first + max_words // 2 - 1, -1):
                if words[j]["text"].endswith((",", ";", ":", "—", "–")):
                    cut = j
                    break
            close(cut)
    return sentences
