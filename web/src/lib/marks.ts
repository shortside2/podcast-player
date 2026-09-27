import { db, newId, type Mark } from './db/db';
import type { Transcript } from './transcript/transcript';

/** 単語 a〜b（両端を含む）からマークを作る。単語1つなら「単語」、文ちょうどなら「文」、それ以外は「範囲」 */
export function buildMark(tx: Transcript, episodeId: string, [a, b]: [number, number]): Mark {
  const sa = tx.sentences[tx.sentenceOfWord(a)];
  const sb = tx.sentences[tx.sentenceOfWord(b)];
  const kind: Mark['kind'] = a === b ? 'word' : sa.firstWord === a && sb.lastWord === b ? 'sentence' : 'range';
  return {
    id: newId(),
    episodeId,
    kind,
    start: tx.aPointForWord(a),
    end: tx.bPointForWord(b),
    firstWord: a,
    lastWord: b,
    text: tx.words.slice(a, b + 1).map((w) => w.text).join(' '),
    note: '',
    mastered: false,
    createdAt: Date.now(),
  };
}

/** 同じ範囲のマークがすでにあればそれを返し、なければ保存する */
export async function addMark(m: Mark): Promise<{ mark: Mark; created: boolean }> {
  const same = await db.marks
    .where('episodeId')
    .equals(m.episodeId)
    .filter((x) => Math.abs(x.start - m.start) < 0.05 && Math.abs(x.end - m.end) < 0.05)
    .first();
  if (same) return { mark: same, created: false };
  await db.marks.add(m);
  return { mark: m, created: true };
}

/**
 * Claude に送るテキスト。装飾はせず、選んだ内容をそのまま出す。
 * メモがあれば次の行に続ける。複数のときは空行で区切る。
 */
export function marksToText(marks: Mark[]): string {
  return marks.map((m) => (m.note.trim() ? `${m.text}\n${m.note.trim()}` : m.text)).join('\n\n');
}

export const KIND_LABEL: Record<Mark['kind'], string> = { word: '単語', sentence: '文', range: '範囲' };

// ---- マーク連続再生の設定（端末に記憶） ----
export interface PlaylistSettings {
  /** 各箇所のリピート回数 */
  repeat: number;
  /** 箇所ごと・繰り返しごとの間隔（秒） */
  gapSec: number;
  /** 前後に付ける余白（秒） */
  padSec: number;
}

const PLAYLIST_KEY = 'listenloop.playlist';

export function loadPlaylistSettings(): PlaylistSettings {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYLIST_KEY) ?? '');
    if (typeof v?.repeat === 'number') return { repeat: v.repeat, gapSec: v.gapSec ?? 1, padSec: v.padSec ?? 0.5 };
  } catch {
    /* 無視 */
  }
  return { repeat: 2, gapSec: 1, padSec: 0.5 };
}

export function savePlaylistSettings(s: PlaylistSettings): void {
  try {
    localStorage.setItem(PLAYLIST_KEY, JSON.stringify(s));
  } catch {
    /* 無視 */
  }
}
