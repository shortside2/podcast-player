import Dexie, { type Table } from 'dexie';
import type { TranscriptDoc } from '../transcript/types';

export interface Episode {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  audioSha256: string | null;
  audioFileName: string;
  audioSize: number;
  wordCount: number;
  lastPosition: number;
  lastPlayedAt: number | null;
  rate: number;
  /** スクリプトの時刻に足す補正（秒）。音とハイライトのずれを手で合わせる用 */
  timingOffset: number;
}

export interface AudioBlobRow {
  episodeId: string;
  blob: Blob;
}

export interface TranscriptRow {
  episodeId: string;
  doc: TranscriptDoc;
}

// 以下は第2〜4段階で使う。スキーマだけ先に確保しておく
export interface SavedRange {
  id: string;
  episodeId: string;
  name: string;
  kind: 'section' | 'ab';
  start: number;
  end: number;
  parentId: string | null;
  repeatCount: number; // 0 = 無限
  gapSec: number;
  createdAt: number;
}

export interface Mark {
  id: string;
  episodeId: string;
  kind: 'word' | 'sentence' | 'range';
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  text: string;
  note: string;
  /** マークの種類（MARK_TAGS の id）。複数付けられる */
  tags?: string[];
  /** 評価（星 0〜5） */
  rating?: number;
  mastered: boolean;
  createdAt: number;
  /** ゴミ箱に入れた日時（入っていなければ undefined / null） */
  deletedAt?: number | null;
}

export interface Recording {
  id: string;
  episodeId: string;
  start: number;
  end: number;
  sentenceIndex: number | null;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

class ListenLoopDB extends Dexie {
  episodes!: Table<Episode, string>;
  audioBlobs!: Table<AudioBlobRow, string>;
  transcripts!: Table<TranscriptRow, string>;
  ranges!: Table<SavedRange, string>;
  marks!: Table<Mark, string>;
  recordings!: Table<Recording, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('listenloop');
    this.version(1).stores({
      episodes: 'id, createdAt, lastPlayedAt, audioSha256',
      audioBlobs: 'episodeId',
      transcripts: 'episodeId',
      ranges: 'id, episodeId, parentId',
      marks: 'id, episodeId, createdAt',
      recordings: 'id, episodeId',
      settings: 'key',
    });
  }
}

export const db = new ListenLoopDB();

export async function deleteEpisode(id: string): Promise<void> {
  await db.transaction('rw', [db.episodes, db.audioBlobs, db.transcripts, db.ranges, db.marks, db.recordings], async () => {
    await db.episodes.delete(id);
    await db.audioBlobs.delete(id);
    await db.transcripts.delete(id);
    await db.ranges.where('episodeId').equals(id).delete();
    await db.marks.where('episodeId').equals(id).delete();
    await db.recordings.where('episodeId').equals(id).delete();
  });
}

/** ブラウザに「このサイトのデータを勝手に消さないで」と要求する */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** crypto.randomUUID は HTTPS でしか使えないため、開発中の http 接続用に代替を用意 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
