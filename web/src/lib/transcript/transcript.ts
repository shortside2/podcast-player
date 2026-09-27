import type { TranscriptDoc, TranscriptSentence, TranscriptWord } from './types';

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
