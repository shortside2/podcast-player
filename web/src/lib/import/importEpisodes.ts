import { db, newId, type Episode } from '../db/db';
import { validateTranscript, type TranscriptDoc } from '../transcript/types';

const AUDIO_EXT = ['m4a', 'mp4', 'aac', 'mp3', 'wav', 'caf'];
const MIME: Record<string, string> = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', caf: 'audio/x-caf',
};

export interface ImportResult {
  imported: string[];
  messages: string[];
}

function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  // crypto.subtle は HTTPS（または localhost）でしか使えない
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 選ばれたファイルを「音声 + JSON」の組にしてエピソードとして保存する。
 * 組み合わせはファイル名（拡張子を除いた部分）で判定。1組だけ選ばれた場合は名前が違っても組にする。
 */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], messages: [] };
  const audios = new Map<string, File>();
  const jsons = new Map<string, File>();
  for (const f of files) {
    const { stem, ext } = splitName(f.name);
    if (ext === 'json') jsons.set(stem, f);
    else if (AUDIO_EXT.includes(ext) || f.type.startsWith('audio/')) audios.set(stem, f);
    else result.messages.push(`対応していないファイルです: ${f.name}`);
  }

  const pairs: [File, File][] = [];
  if (audios.size === 1 && jsons.size === 1) {
    pairs.push([[...audios.values()][0], [...jsons.values()][0]]);
  } else {
    for (const [stem, a] of audios) {
      const j = jsons.get(stem);
      if (j) {
        pairs.push([a, j]);
        jsons.delete(stem);
      } else {
        result.messages.push(`スクリプト（${stem}.json）が選ばれていません: ${a.name}`);
      }
    }
    for (const j of jsons.values()) result.messages.push(`音声が選ばれていません: ${j.name}`);
  }

  for (const [audioFile, jsonFile] of pairs) {
    try {
      const id = await importPair(audioFile, jsonFile, result);
      if (id) result.imported.push(id);
    } catch (e) {
      result.messages.push(`${audioFile.name}: 取り込みに失敗しました（${(e as Error).message}）`);
    }
  }
  return result;
}

async function importPair(audioFile: File, jsonFile: File, result: ImportResult): Promise<string | null> {
  let doc: TranscriptDoc;
  try {
    doc = JSON.parse(await jsonFile.text());
  } catch {
    result.messages.push(`${jsonFile.name}: JSON を読み込めませんでした`);
    return null;
  }
  const problem = validateTranscript(doc);
  if (problem) {
    result.messages.push(`${jsonFile.name}: ${problem}`);
    return null;
  }

  const { ext } = splitName(audioFile.name);
  if (ext === 'mp3') {
    result.messages.push(`${audioFile.name}: mp3 は iPhone で位置がずれやすいため、Mac ツールが作る m4a の利用をおすすめします`);
  }

  // Safari では File を直接 IndexedDB に入れると失敗することがあるため、中身をコピーした Blob にする
  const buf = await audioFile.arrayBuffer();
  const sha = await sha256Hex(buf);
  if (sha && doc.audio.sha256 && sha !== doc.audio.sha256) {
    result.messages.push(
      `${audioFile.name}: スクリプトと音声の組み合わせが違います（JSON は ${doc.audio.fileName} 用）。取り込みを中止しました`);
    return null;
  }
  if (sha) {
    const dup = await db.episodes.where('audioSha256').equals(sha).first();
    if (dup) {
      result.messages.push(`${audioFile.name}: すでに「${dup.title}」として取り込み済みです`);
      return null;
    }
  }

  const id = newId();
  const episode: Episode = {
    id,
    title: doc.title || splitName(audioFile.name).stem,
    createdAt: Date.now(),
    duration: doc.audio.duration,
    audioSha256: sha,
    audioFileName: audioFile.name,
    audioSize: buf.byteLength,
    wordCount: doc.words.length,
    lastPosition: 0,
    lastPlayedAt: null,
    rate: 1,
    timingOffset: 0,
  };
  const blob = new Blob([buf], { type: MIME[ext] || audioFile.type || 'audio/mp4' });
  await db.transaction('rw', [db.episodes, db.audioBlobs, db.transcripts], async () => {
    await db.audioBlobs.put({ episodeId: id, blob });
    await db.transcripts.put({ episodeId: id, doc });
    await db.episodes.put(episode);
  });
  return id;
}
