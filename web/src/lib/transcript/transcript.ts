import type { TranscriptDoc, TranscriptSentence, TranscriptWord } from './types';

const A_PREROLL = 0.05;
const B_TAIL = 0.1;

/**
 * 再生中に何度も引く「時刻 → 単語／文」の検索を速くするための索引。
 * 1万単語でも二分探索なので 1 回あたり十数回の比較で済む。
 */
export class Transcript {
  readonly words: TranscriptWord[];
  readonly sentences: TranscriptSentence[];
  readonly duration: number;
  private readonly wordStarts: Float64Array;
  private readonly sentenceStarts: Float64Array;
  private readonly wordToSentence: Int32Array;

  constructor(readonly doc: TranscriptDoc) {
    this.words = doc.words;
    this.sentences = doc.sentences.length > 0 ? doc.sentences : [{
      start: doc.words[0].start,
      end: doc.words[doc.words.length - 1].end,
      firstWord: 0,
      lastWord: doc.words.length - 1,
    }];
    this.duration = doc.audio.duration;
    this.wordStarts = Float64Array.from(this.words, (w) => w.start);
    this.sentenceStarts = Float64Array.from(this.sentences, (s) => s.start);
    this.wordToSentence = new Int32Array(this.words.length).fill(-1);
    this.sentences.forEach((s, si) => {
      for (let i = s.firstWord; i <= s.lastWord && i < this.words.length; i++) this.wordToSentence[i] = si;
    });
  }

  /** 時刻 t 以前に始まった最後の単語。先頭より前なら -1 */
  wordAt(t: number): number {
    return lastAtOrBefore(this.wordStarts, t);
  }

  /** 時刻 t 以前に始まった最後の文。先頭より前なら -1 */
  sentenceAt(t: number): number {
    return lastAtOrBefore(this.sentenceStarts, t);
  }

  sentenceOfWord(i: number): number {
    return this.wordToSentence[i] ?? -1;
  }

  /** 時刻 t 以降に始まる最初の単語 */
  firstWordAtOrAfter(t: number): number {
    return Math.min(lastAtOrBefore(this.wordStarts, t - 1e-6) + 1, this.words.length - 1);
  }

  /** [start, end) に始まる単語の番号の範囲。1語もなければ null */
  wordRangeForTimes(start: number, end: number): [number, number] | null {
    const a = this.firstWordAtOrAfter(start);
    const b = this.wordAt(end - 1e-3);
    if (a < 0 || b < a) return null;
    return [a, b];
  }

  /** 単語 i から始める A 点（語頭が欠けないよう少し手前） */
  aPointForWord(i: number): number {
    return Math.max(0, this.words[i].start - A_PREROLL);
  }

  /** 単語 j で終わる B 点（語尾が切れないよう少し後ろ。ただし次の単語には食い込まない） */
  bPointForWord(j: number): number {
    const w = this.words[j];
    const next = this.words[j + 1];
    if (!next) return Math.min(this.duration, w.end + B_TAIL);
    return Math.min(w.end + B_TAIL, Math.max(w.end, next.start));
  }

  /** A 点から、その範囲の最初の単語 */
  wordForAPoint(a: number): number {
    return this.firstWordAtOrAfter(a + 1e-3);
  }

  /** B 点から、その範囲の最後の単語 */
  wordForBPoint(b: number): number {
    return Math.max(0, this.wordAt(b - 1e-3));
  }
}

function lastAtOrBefore(arr: Float64Array, t: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
