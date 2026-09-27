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

/** 段落（話者のひとまとまりの発言）。日本語訳を持てる */
export interface TranscriptParagraph {
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  speaker?: string | null;
  ja?: string | null;
}

/** 話題。アプリでは見出しになり、タップするとその範囲が区間になる */
export interface TranscriptTopic {
  titleEn?: string | null;
  titleJa?: string | null;
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  firstParagraph?: number;
  lastParagraph?: number;
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
  paragraphs?: TranscriptParagraph[];
  topics?: TranscriptTopic[];
  revision?: { source: string; editedAt: string | null };
}

export const SUPPORTED_SCHEMA_VERSIONS = [1];

/** 読み込んだ JSON が使える形かを確認し、問題があれば日本語のメッセージを返す */
export function validateTranscript(doc: unknown): string | null {
  const d = doc as Partial<TranscriptDoc>;
  if (!d || typeof d !== 'object') return 'JSON の形式が正しくありません';
  const raw = doc as Record<string, unknown>;
  if (Array.isArray(raw.segments) && Array.isArray(raw.sections) && !Array.isArray(raw.words)) {
    return 'これはチャットで作った「訳・話題」のファイルです。Mac で add_bilingual.py を実行してスクリプトに取り込んでから、スクリプトの .json（mp3 と同じ名前のもの）を選んでください';
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(d.schemaVersion as number)) {
    return `未対応のスキーマバージョンです（${String(d.schemaVersion)}）`;
  }
  if (!Array.isArray(d.words) || d.words.length === 0) return '単語（words）がありません';
  if (!Array.isArray(d.sentences)) return '文（sentences）がありません';
  if (!d.audio || typeof d.audio.duration !== 'number') return 'audio.duration がありません';
  return null;
}
