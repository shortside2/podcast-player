import { db, type TranslationRow } from '../db/db';
import { Translations } from './translation';
import type { TranscriptDoc } from './types';

/** エピソードの訳（取り込んだ訳データ＋スクリプト内の訳）を読み込む */
export async function loadTranslations(episodeId: string, doc: TranscriptDoc): Promise<{ row: TranslationRow | null; tr: Translations }> {
  const row = (await db.translations.get(episodeId)) ?? null;
  return { row, tr: new Translations(doc, row) };
}

/**
 * 訳を取り込む。すでにある訳データに文ごとに足す（同じ ID は上書き、ほかの文の訳は残す）。
 * 戻り値: 新しく増えた件数と上書きした件数
 */
export async function mergeTranslations(
  episodeId: string,
  entries: Map<number, string>,
  sentenceCount: number,
): Promise<{ added: number; replaced: number }> {
  let added = 0;
  let replaced = 0;
  await db.transaction('rw', db.translations, async () => {
    const cur = await db.translations.get(episodeId);
    const sentences: Record<number, string> = { ...(cur?.sentences ?? {}) };
    for (const [id, ja] of entries) {
      if (sentences[id] === undefined) added++;
      else if (sentences[id] !== ja) replaced++;
      sentences[id] = ja;
    }
    await db.translations.put({ episodeId, version: 1, sentences, sentenceCount, updatedAt: Date.now() });
  });
  return { added, replaced };
}

/** 取り込んだ訳データだけを消す（スクリプトの中の訳や、ほかのデータには触れない） */
export async function deleteTranslations(episodeId: string): Promise<void> {
  await db.translations.delete(episodeId);
}
