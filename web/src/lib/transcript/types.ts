// スクリプト JSON（schemaVersion 1）の型。仕様は docs/transcript-schema.md

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker?: string | null;
  confidence?: number | null;
}

export interface TranscriptSentence {
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  speaker?: string | null;
}

export interface TranscriptDoc {
  schemaVersion: number;
  title?: string;
  generator?: Record<string, unknown>;
  audio: {
    fileName: string;
    duration: number;
    sha256?: string;
    source?: { fileName: string; sha256?: string };
    syncCheck?: Record<string, unknown>;
  };
  language?: string;
  speakers?: { id: string; name: string | null }[];
  words: TranscriptWord[];
  sentences: TranscriptSentence[];
  revision?: { source: string; editedAt: string | null };
}

export const SUPPORTED_SCHEMA_VERSIONS = [1];

/** 読み込んだ JSON が使える形かを確認し、問題があれば日本語のメッセージを返す */
export function validateTranscript(doc: unknown): string | null {
  const d = doc as Partial<TranscriptDoc>;
  if (!d || typeof d !== 'object') return 'JSON の形式が正しくありません';
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(d.schemaVersion as number)) {
    return `未対応のスキーマバージョンです（${String(d.schemaVersion)}）`;
  }
  if (!Array.isArray(d.words) || d.words.length === 0) return '単語（words）がありません';
  if (!Array.isArray(d.sentences)) return '文（sentences）がありません';
  if (!d.audio || typeof d.audio.duration !== 'number') return 'audio.duration がありません';
  return null;
}
