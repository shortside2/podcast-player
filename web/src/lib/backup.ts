import { db, type Mark, type SavedRange } from './db/db';

/**
 * 範囲・マーク・メモのバックアップ（1 つの JSON ファイル）。
 * 音声とスクリプトは含めない（Mac に元のファイルがあるため）。録音も第 4 段階以降で検討。
 *
 * エピソードは端末ごとに ID が違うので、音声の SHA-256 で対応付ける。
 */
const BACKUP_VERSION = 1;

interface BackupEpisode {
  audioSha256: string;
  title: string;
  lastPosition: number;
  rate: number;
  timingOffset: number;
}

interface BackupFile {
  app: 'ListenLoop';
  backupVersion: number;
  exportedAt: string;
  episodes: BackupEpisode[];
  ranges: (Omit<SavedRange, 'episodeId'> & { audioSha256: string })[];
  marks: (Omit<Mark, 'episodeId'> & { audioSha256: string })[];
}

export async function exportBackup(): Promise<{ name: string; text: string; counts: string }> {
  const [episodes, ranges, marks] = await Promise.all([db.episodes.toArray(), db.ranges.toArray(), db.marks.toArray()]);
  const sha = new Map(episodes.filter((e) => e.audioSha256).map((e) => [e.id, e.audioSha256!]));
  const strip = <T extends { episodeId: string }>(x: T) => {
    const { episodeId, ...rest } = x;
    return { ...rest, audioSha256: sha.get(episodeId)! };
  };
  const file: BackupFile = {
    app: 'ListenLoop',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    episodes: episodes
      .filter((e) => e.audioSha256)
      .map((e) => ({ audioSha256: e.audioSha256!, title: e.title, lastPosition: e.lastPosition, rate: e.rate, timingOffset: e.timingOffset })),
    ranges: ranges.filter((r) => sha.has(r.episodeId)).map(strip),
    marks: marks.filter((m) => sha.has(m.episodeId)).map(strip),
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    name: `listenloop-backup-${stamp}.json`,
    text: JSON.stringify(file, null, 1),
    counts: `エピソード ${file.episodes.length}・範囲 ${file.ranges.length}・マーク ${file.marks.length}`,
  };
}

/** バックアップを読み込む。同じ ID のものは上書き、無いものは追加（消すことはしない） */
export async function importBackup(text: string): Promise<string[]> {
  let data: BackupFile;
  try {
    data = JSON.parse(text);
  } catch {
    return ['ファイルを読み込めませんでした'];
  }
  if (data?.app !== 'ListenLoop' || data.backupVersion !== BACKUP_VERSION) return ['ListenLoop のバックアップファイルではありません'];

  const episodes = await db.episodes.toArray();
  const idBySha = new Map(episodes.filter((e) => e.audioSha256).map((e) => [e.audioSha256!, e.id]));
  const missing = data.episodes.filter((e) => !idBySha.has(e.audioSha256));

  let ranges = 0;
  let marks = 0;
  await db.transaction('rw', [db.episodes, db.ranges, db.marks], async () => {
    for (const e of data.episodes) {
      const id = idBySha.get(e.audioSha256);
      if (id) await db.episodes.update(id, { lastPosition: e.lastPosition, rate: e.rate, timingOffset: e.timingOffset });
    }
    for (const { audioSha256, ...r } of data.ranges) {
      const episodeId = idBySha.get(audioSha256);
      if (!episodeId) continue;
      await db.ranges.put({ ...r, episodeId });
      ranges++;
    }
    for (const { audioSha256, ...m } of data.marks) {
      const episodeId = idBySha.get(audioSha256);
      if (!episodeId) continue;
      await db.marks.put({ ...m, episodeId });
      marks++;
    }
  });

  const msgs = [`復元しました：範囲 ${ranges}・マーク ${marks}`];
  if (missing.length) {
    msgs.push(
      `次のエピソードは取り込まれていないため、その分は復元していません。音声とスクリプトを取り込んでから、もう一度読み込んでください：${missing.map((e) => `「${e.title}」`).join('、')}`,
    );
  }
  return msgs;
}
