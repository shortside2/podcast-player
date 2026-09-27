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
    tags: [],
    rating: 0,
    mastered: false,
    createdAt: Date.now(),
  };
}

/** 同じ範囲のマークがすでにあればそれを返し（ゴミ箱にあれば戻す）、なければ保存する */
export async function addMark(m: Mark): Promise<{ mark: Mark; created: boolean }> {
  const same = await db.marks
    .where('episodeId')
    .equals(m.episodeId)
    .filter((x) => Math.abs(x.start - m.start) < 0.05 && Math.abs(x.end - m.end) < 0.05)
    .first();
  if (same) {
    if (same.deletedAt) {
      await db.marks.update(same.id, { deletedAt: null });
      return { mark: { ...same, deletedAt: null }, created: true };
    }
    return { mark: same, created: false };
  }
  await db.marks.add(m);
  return { mark: m, created: true };
}

/** マークの種類。Claude に送るとき、どう分からなかったかを毎回書かなくて済むようにする */
export const MARK_TAGS = [
  { id: 'listen', label: '聞き取れない', hint: '音がつかめない・速い・つながって聞こえる', color: '#5aa9ff' },
  { id: 'unknown', label: '知らない表現', hint: '単語・イディオム・スラングを知らない', color: '#ffae42' },
  { id: 'meaning', label: '意味がつかめない', hint: '単語は分かるのに、文の構造や言い回しで意味がすっと入らない', color: '#b58cff' },
  { id: 'use', label: '使いたい表現', hint: '言い回しを覚えて自分でも使いたい', color: '#4cd08a' },
] as const;

export const TAG_LABEL: Record<string, string> = Object.fromEntries(MARK_TAGS.map((t) => [t.id, t.label]));
export const TAG_COLOR: Record<string, string> = Object.fromEntries(MARK_TAGS.map((t) => [t.id, t.color]));
/** タグが付いていないマークの色 */
export const UNTAGGED_COLOR = '#ff7eb6';

/** マークの色（最初に付けたタグの色） */
export function markColor(m: Mark): string {
  return TAG_COLOR[m.tags?.[0] ?? ''] ?? UNTAGGED_COLOR;
}

/** 16 進の色に透明度を付ける（#rrggbb → rgba） */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** ゴミ箱に入っていないマーク */
export const isLive = (m: Mark) => !m.deletedAt;

/**
 * Claude に送るテキスト。装飾はせず、選んだ内容をそのまま出す。
 * 種類（タグ）があれば先頭に [聞き取れない] のように付け、メモがあれば次の行に続ける。
 * 複数のときは空行で区切る。
 */
export function marksToText(marks: Mark[]): string {
  return marks
    .map((m) => {
      const tags = (m.tags ?? []).map((t) => TAG_LABEL[t]).filter(Boolean);
      const head = tags.length ? `[${tags.join('・')}] ${m.text}` : m.text;
      return m.note.trim() ? `${head}\n${m.note.trim()}` : head;
    })
    .join('\n\n');
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
