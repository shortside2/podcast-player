import type { TranslationRow } from '../db/db';
import type { TranscriptDoc } from './types';

/**
 * 日本語訳を「英文のどの文に対応するか」で引けるようにまとめる。
 *
 * 訳の出どころ（優先順）
 *   1. 取り込んだ訳データ（TranslationRow、文の ID ごと）
 *   2. スクリプト JSON の paragraphs[].jaSentences（podcast-prep で作った回。文の範囲ごと）
 *   3. スクリプト JSON の paragraphs[].ja（古い回。段落まるごとの訳しかない）
 *
 * 文の ID = スクリプトの sentences の番号（0 から）。
 */

/** 表示する訳のひとかたまり。sentences はこの訳に対応する英文の文番号 */
export interface JaUnit {
  text: string;
  sentences: number[];
  /** 'sentence' = 文単位で対応している / 'paragraph' = 段落まるごとの訳 */
  level: 'sentence' | 'paragraph';
}

export class Translations {
  /** 文番号 → 文単位の訳の出どころ（同じ jaSentences の要素なら同じオブジェクト） */
  private readonly bySentence = new Map<number, { text: string; key: object | number }>();
  /** 文番号 → JSON の段落番号 */
  private readonly paraOfSentence: Int32Array;

  constructor(
    private readonly doc: TranscriptDoc,
    imported: TranslationRow | null | undefined,
  ) {
    const sentences = doc.sentences;
    this.paraOfSentence = new Int32Array(sentences.length).fill(-1);
    const paras = doc.paragraphs ?? [];
    let pi = 0;
    sentences.forEach((s, si) => {
      while (pi < paras.length && paras[pi].lastWord < s.firstWord) pi++;
      if (pi < paras.length && s.firstWord >= paras[pi].firstWord) this.paraOfSentence[si] = pi;
    });
    // 2. jaSentences（文の範囲ごとの訳）
    for (const p of paras) {
      for (const u of p.jaSentences ?? []) {
        const key = {};
        for (let si = u.firstSentence; si <= u.lastSentence; si++) this.bySentence.set(si, { text: u.text, key });
      }
    }
    // 1. 取り込んだ訳データ（文ごと）が最優先
    for (const [id, text] of Object.entries(imported?.sentences ?? {})) {
      const si = Number(id);
      if (Number.isInteger(si) && si >= 0 && si < sentences.length && text.trim()) this.bySentence.set(si, { text: text.trim(), key: si });
    }
  }

  /** 文単位の訳が 1 つでもあるか */
  get hasSentenceLevel(): boolean {
    return this.bySentence.size > 0;
  }

  /** 何かしらの訳（段落の訳を含む）があるか */
  get hasAny(): boolean {
    return this.hasSentenceLevel || !!this.doc.paragraphs?.some((p) => p.ja);
  }

  /** 文単位の訳がある文の数 */
  get sentenceLevelCount(): number {
    return this.bySentence.size;
  }

  hasSentence(si: number): boolean {
    return this.bySentence.has(si);
  }

  /**
   * 段落（文番号の並び）に表示する訳のかたまり。
   * 文単位の訳が 1 つもなければ、段落の訳（paragraphJa）を 1 かたまりで返す。
   */
  unitsFor(sentenceIndices: number[], paragraphJa: string | null | undefined): JaUnit[] {
    const units: JaUnit[] = [];
    let last: { key: object | number; unit: JaUnit } | null = null;
    for (const si of sentenceIndices) {
      const hit = this.bySentence.get(si);
      if (!hit) {
        last = null;
        continue;
      }
      // 同じ訳（jaSentences の 1 要素が複数の文にまたがる）は 1 かたまりにする
      if (last && last.key === hit.key) {
        last.unit.sentences.push(si);
        continue;
      }
      const unit: JaUnit = { text: hit.text, sentences: [si], level: 'sentence' };
      units.push(unit);
      last = { key: hit.key, unit };
    }
    if (units.length === 0 && paragraphJa) return [{ text: paragraphJa, sentences: [...sentenceIndices], level: 'paragraph' }];
    return units;
  }

  /**
   * 文 a〜b を含む訳（記録の一覧に出す用）。
   * 文単位の訳があればそれをつなげ、なければその文を含む段落の訳、それもなければ null。
   */
  forSentences(a: number, b: number): { text: string; level: 'sentence' | 'paragraph' } | null {
    const texts: string[] = [];
    let lastKey: object | number | null = null;
    for (let si = a; si <= b; si++) {
      const hit = this.bySentence.get(si);
      if (!hit || hit.key === lastKey) continue;
      texts.push(hit.text);
      lastKey = hit.key;
    }
    if (texts.length) return { text: texts.join(''), level: 'sentence' };
    const paras = this.doc.paragraphs ?? [];
    const seen = new Set<number>();
    const pj: string[] = [];
    for (let si = a; si <= b; si++) {
      const pi = this.paraOfSentence[si];
      if (pi < 0 || seen.has(pi)) continue;
      seen.add(pi);
      if (paras[pi]?.ja) pj.push(paras[pi].ja!);
    }
    return pj.length ? { text: pj.join(''), level: 'paragraph' } : null;
  }
}

// ---- 訳の準備用に書き出す ----

/** 文を「[ID] 英文」の 1 行ずつにする。onlyMissing なら、文単位の訳がまだない文だけ */
export function exportSentencesForTranslation(doc: TranscriptDoc, tr: Translations | null, onlyMissing = false): { text: string; count: number } {
  const lines: string[] = [];
  doc.sentences.forEach((s, si) => {
    if (onlyMissing && tr?.hasSentence(si)) return;
    const en = doc.words
      .slice(s.firstWord, s.lastWord + 1)
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (en) lines.push(`[${si}] ${en}`);
  });
  return { text: lines.join('\n'), count: lines.length };
}

// ---- 訳データの取り込み ----

export interface ParseError {
  /** 何行目か（JSON なら何番目の要素か）。1 から */
  line: number;
  content: string;
  reason: string;
}

export interface ParseResult {
  entries: Map<number, string>;
  errors: ParseError[];
  format: 'json' | 'text';
}

const clip = (s: string) => (s.length > 60 ? s.slice(0, 60) + '…' : s);

/**
 * 返ってきた訳を読み取る。次のどちらの形でもよい
 *   JSON: { "version": 1, "sentences": [ { "id": 12, "ja": "…" } ] }（配列だけでも可）
 *   テキスト: 1 行に「[ID] 訳文」
 * ID がこの回の文に無いもの・形式が違う行・同じ ID の重複はエラーとして返す（正しい行は取り込める）
 */
export function parseTranslationInput(input: string, sentenceCount: number): ParseResult {
  const entries = new Map<number, string>();
  const errors: ParseError[] = [];
  const range = `この回の文の ID は 0〜${sentenceCount - 1} です`;
  const add = (line: number, content: string, idRaw: unknown, jaRaw: unknown) => {
    const id = typeof idRaw === 'string' && /^\d+$/.test(idRaw.trim()) ? Number(idRaw) : idRaw;
    if (typeof id !== 'number' || !Number.isInteger(id)) return errors.push({ line, content: clip(content), reason: 'ID が数字ではありません' });
    if (id < 0 || id >= sentenceCount) return errors.push({ line, content: clip(content), reason: `ID ${id} に一致する文がありません（${range}）` });
    const ja = typeof jaRaw === 'string' ? jaRaw.trim() : '';
    if (!ja) return errors.push({ line, content: clip(content), reason: `ID ${id} の訳文が空です` });
    if (entries.has(id)) return errors.push({ line, content: clip(content), reason: `ID ${id} が重複しています（後の行は取り込みません）` });
    entries.set(id, ja);
  };

  const text = input.replace(/^﻿/, '').trim();
  // JSON（「[0] 訳文」で始まるテキストも [ で始まるので、[数字] で始まるものは JSON とみなさない）
  if (text.startsWith('{') || (text.startsWith('[') && !/^\[\s*\d+\s*\]/.test(text))) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      errors.push({ line: 1, content: clip(text), reason: 'JSON として読み込めませんでした' });
      return { entries, errors, format: 'json' };
    }
    const list = Array.isArray(data) ? data : (data as { sentences?: unknown })?.sentences;
    if (!Array.isArray(list)) {
      errors.push({ line: 1, content: clip(text), reason: '"sentences" の一覧がありません' });
      return { entries, errors, format: 'json' };
    }
    list.forEach((x, i) => {
      const o = x as { id?: unknown; ja?: unknown };
      add(i + 1, JSON.stringify(x), o?.id, o?.ja);
    });
    return { entries, errors, format: 'json' };
  }

  // テキスト「[ID] 訳文」
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    // 空行と、チャットの回答に付きがちな ``` の行は読み飛ばす
    if (!line || line.startsWith('```')) return;
    const m = /^\[\s*(\d+)\s*\]\s*(.*)$/.exec(line);
    if (!m) return errors.push({ line: i + 1, content: clip(line), reason: '「[ID] 訳文」の形ではありません' });
    add(i + 1, line, m[1], m[2]);
  });
  return { entries, errors, format: 'text' };
}
