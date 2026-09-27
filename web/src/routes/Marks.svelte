<script lang="ts">
  import { liveQuery } from 'dexie';
  import { onDestroy, onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MarkEditor from '../components/MarkEditor.svelte';
  import Stars from '../components/Stars.svelte';
  import { db, type Episode, type Mark } from '../lib/db/db';
  import { dialog } from '../lib/dialog.svelte';
  import { formatTime } from '../lib/format';
  import {
    KIND_LABEL,
    MARK_TAGS,
    TAG_COLOR,
    TAG_LABEL,
    isLive,
    loadPlaylistSettings,
    markColor,
    marksToText,
    savePlaylistSettings,
  } from '../lib/marks';
  import { PlaybackEngine } from '../lib/playback/engine.svelte';
  import { LoopController } from '../lib/playback/loop.svelte';
  import { MarkPlayer } from '../lib/playback/markPlayer.svelte';
  import { connectMediaSession } from '../lib/playback/mediaSession';
  import { router } from '../lib/router.svelte';
  import { Transcript } from '../lib/transcript/transcript';
  import type { TranscriptTopic } from '../lib/transcript/types';

  let { episodeId }: { episodeId: string | null } = $props();

  const REPEATS = [1, 2, 3, 5];
  const GAPS = [0, 0.5, 1, 2, 3];
  const PADS = [0, 0.3, 0.5, 1];
  const VIEW_KEY = 'listenloop.marksView';

  // svelte-ignore state_referenced_locally
  const marks = liveQuery(() => (episodeId ? db.marks.where('episodeId').equals(episodeId).toArray() : db.marks.toArray()));
  const episodes = liveQuery(() => db.episodes.toArray());

  const saved = readView();
  let showMastered = $state(false);
  let showTrash = $state(false);
  let selecting = $state(false);
  let selected = $state<Set<string>>(new Set());
  let editing = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let playlist = $state(loadPlaylistSettings());
  let settingsOpen = $state(false);
  /** 絞り込み: 'all' / タグの id / 'none'（タグなし） */
  let tagFilter = $state<string>('all');
  /** 並べ替え: 時刻順 / 評価の高い順 / 新しい順 */
  let sort = $state<'time' | 'rating' | 'new'>(saved.sort);
  /** まとめ方: 話題（章）ごと / まとめて */
  let grouping = $state<'topic' | 'flat'>(saved.grouping);

  function readView(): { sort: 'time' | 'rating' | 'new'; grouping: 'topic' | 'flat' } {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '');
      return { sort: v.sort ?? 'time', grouping: v.grouping ?? 'topic' };
    } catch {
      return { sort: 'time', grouping: 'topic' };
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ sort, grouping }));
    } catch {
      /* 無視 */
    }
  });

  // ---- この画面の中での再生（全文に戻らずに聞く） ----
  const engine = new PlaybackEngine();
  /** 読み込んだスクリプト（話題の見出し・範囲の修正・余白の計算に使う） */
  let transcripts = $state.raw(new Map<string, Transcript>());
  const offsets = new Map<string, number>();
  let loadedEpisode: string | null = null;
  const offsetOfCurrent = (): number => offsets.get(markPlayer.current?.episodeId ?? '') ?? 0;
  const loop: LoopController = new LoopController(engine, offsetOfCurrent, (r) => {
    if (r.kind === 'ab') markPlayer.onRepeatDone();
  });
  const markPlayer: MarkPlayer = new MarkPlayer(engine, loop, (m) => transcripts.get(m.episodeId) ?? null, offsetOfCurrent, () =>
    showToast('最後まで再生しました'),
  );
  let disconnectMedia: (() => void) | null = null;

  async function loadTranscript(epId: string): Promise<void> {
    if (transcripts.has(epId)) return;
    const tr = await db.transcripts.get(epId);
    if (!tr || transcripts.has(epId)) return;
    transcripts = new Map(transcripts).set(epId, new Transcript(tr.doc));
  }

  // 一覧に出てくるエピソードのスクリプトを読み込む
  $effect(() => {
    const ids = new Set(($marks ?? []).map((m) => m.episodeId));
    for (const epId of ids) void loadTranscript(epId);
  });

  /** エピソードの音声を読み込む（すでに読み込んでいれば何もしない） */
  async function ensureLoaded(epId: string): Promise<boolean> {
    if (loadedEpisode === epId) return true;
    const [ep, audio] = await Promise.all([db.episodes.get(epId), db.audioBlobs.get(epId), loadTranscript(epId)]);
    if (!ep || !audio) return false;
    offsets.set(epId, ep.timingOffset);
    engine.load(audio.blob, 0, ep.rate);
    loadedEpisode = epId;
    disconnectMedia?.();
    disconnectMedia = connectMediaSession(engine, {
      title: `${ep.title}（マーク）`,
      artworkUrl: new URL('icon-512.png', document.baseURI).href,
      onPrevSentence: () => markPlayer.step(-1),
      onNextSentence: () => markPlayer.step(1),
      onSkip: (d) => engine.skip(d),
      onSeekTo: (t) => engine.seek(t),
    });
    return true;
  }

  onMount(() => {
    // エピソード別の一覧なら、先に音声を読み込んでおく（▶ ですぐ再生できるように）
    if (episodeId) void ensureLoaded(episodeId);
  });

  onDestroy(() => {
    markPlayer.destroy();
    loop.destroy();
    disconnectMedia?.();
    engine.unload();
  });

  /** マークを再生する（list の index 番目から） */
  async function play(list: Mark[], index: number) {
    if (!list.length) return;
    const ep = list[index].episodeId;
    const queue = list.filter((m) => m.episodeId === ep);
    const ready = loadedEpisode === ep;
    if (!ready && !(await ensureLoaded(ep))) return showToast('エピソードが見つかりません');
    savePlaylistSettings(playlist);
    markPlayer.start(queue, { ...playlist }, queue.indexOf(list[index]), true);
    // 別のエピソードを読み込んだ直後は、iPhone が再生を止めることがある
    if (!ready) setTimeout(() => { if (!engine.playing) showToast('もう一度 ▶ を押してください'); }, 1500);
  }

  function openInPlayer(m: Mark) {
    markPlayer.stop();
    engine.pause();
    router.go(`#/episode/${m.episodeId}?t=${m.start.toFixed(2)}`);
  }

  async function copy(list: Mark[]) {
    if (!list.length) return showToast('コピーするマークがありません');
    try {
      await navigator.clipboard.writeText(marksToText(list));
      showToast(`${list.length} 件をコピーしました`);
    } catch {
      showToast('コピーできませんでした');
    }
  }

  const epMap = $derived(new Map(($episodes ?? []).map((e) => [e.id, e])));

  function sortMarks(ms: Mark[]): Mark[] {
    const byTime = (a: Mark, b: Mark) => a.start - b.start;
    if (sort === 'rating') return ms.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byTime(a, b));
    if (sort === 'new') return ms.sort((a, b) => b.createdAt - a.createdAt);
    return ms.sort(byTime);
  }

  function topicOf(m: Mark): { index: number; topic: TranscriptTopic } | null {
    const topics = transcripts.get(m.episodeId)?.doc.topics ?? [];
    const i = topics.findIndex((t) => m.firstWord >= t.firstWord && m.firstWord <= t.lastWord);
    return i === -1 ? null : { index: i, topic: topics[i] };
  }

  interface Group {
    key: string;
    title: string | null;
    subtitle: string | null;
    marks: Mark[];
  }

  // エピソードごと（さらに「話題ごと」なら話題ごと）にまとめる
  const groups = $derived.by((): Group[] => {
    const list = ($marks ?? []).filter(
      (m) =>
        isLive(m) &&
        (showMastered || !m.mastered) &&
        (tagFilter === 'all' || (tagFilter === 'none' ? !m.tags?.length : m.tags?.includes(tagFilter))),
    );
    const byEp = new Map<string, Mark[]>();
    for (const m of list) {
      if (!byEp.has(m.episodeId)) byEp.set(m.episodeId, []);
      byEp.get(m.episodeId)!.push(m);
    }
    const eps = [...byEp.entries()].sort(
      ([a], [b]) => (epMap.get(b)?.lastPlayedAt ?? 0) - (epMap.get(a)?.lastPlayedAt ?? 0),
    );
    const out: Group[] = [];
    for (const [epId, ms] of eps) {
      const epTitle = episodeId ? null : ((epMap.get(epId) as Episode | undefined)?.title ?? '（削除されたエピソード）');
      if (grouping === 'topic' && transcripts.get(epId)?.doc.topics?.length) {
        const byTopic = new Map<number, Mark[]>();
        for (const m of ms) {
          const k = topicOf(m)?.index ?? -1;
          if (!byTopic.has(k)) byTopic.set(k, []);
          byTopic.get(k)!.push(m);
        }
        const topics = transcripts.get(epId)!.doc.topics!;
        for (const [k, tms] of [...byTopic.entries()].sort(([a], [b]) => a - b)) {
          const t = topics[k];
          out.push({
            key: `${epId}:${k}`,
            title: epTitle,
            subtitle: t ? `${k + 1}. ${t.titleJa || t.titleEn}` : 'その他',
            marks: sortMarks(tms),
          });
        }
      } else {
        out.push({ key: epId, title: epTitle, subtitle: null, marks: sortMarks(ms) });
      }
    }
    return out;
  });
  const allVisible = $derived(groups.flatMap((g) => g.marks));
  const masteredCount = $derived(($marks ?? []).filter((m) => isLive(m) && m.mastered).length);
  const trashed = $derived(($marks ?? []).filter((m) => !isLive(m)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)));

  function showToast(text: string) {
    toast = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2500);
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectedMarks(): Mark[] {
    return allVisible.filter((m) => selected.has(m.id));
  }

  function setPlaylist(patch: Partial<typeof playlist>) {
    playlist = { ...playlist, ...patch };
    savePlaylistSettings(playlist);
  }

  // ---- ゴミ箱 ----
  async function restore(m: Mark) {
    await db.marks.update(m.id, { deletedAt: null });
    showToast('元に戻しました');
  }

  async function purge(m: Mark) {
    if (!(await dialog.confirm('完全に削除しますか？', { message: '元に戻せなくなります。', okLabel: '削除', danger: true }))) return;
    await db.marks.delete(m.id);
  }

  async function emptyTrash() {
    const ok = await dialog.confirm(`ゴミ箱の ${trashed.length} 件を完全に削除しますか？`, { message: '元に戻せなくなります。', okLabel: '削除', danger: true });
    if (!ok) return;
    await db.marks.bulkDelete(trashed.map((m) => m.id));
    showToast('ゴミ箱を空にしました');
  }

  const playlistSummary = $derived(`${playlist.repeat}回・間隔${playlist.gapSec}秒・余白${playlist.padSec}秒`);
</script>

<div class="page">
  <header>
    <button class="icon-btn" aria-label="戻る" onclick={() => router.back(episodeId ? `#/episode/${episodeId}` : '#/')}><Icon name="chevron-left" /></button>
    <h1>{showTrash ? 'ゴミ箱' : episodeId ? (epMap.get(episodeId)?.title ?? 'マーク') : 'すべてのマーク'}</h1>
    {#if showTrash}
      <button class="pill" onclick={() => (showTrash = false)}>一覧に戻る</button>
    {:else}
      <button class="pill" onclick={() => copy(allVisible)}>コピー</button>
      <button class="pill" class:on={selecting} onclick={() => { selecting = !selecting; selected = new Set(); }}>{selecting ? 'やめる' : '選択'}</button>
    {/if}
  </header>

  {#if showTrash}
    {#if trashed.length}
      <div class="trash-head">
        <span>{trashed.length} 件</span>
        <button class="pill danger" onclick={emptyTrash}>ゴミ箱を空にする</button>
      </div>
      <ul>
        {#each trashed as m (m.id)}
          <li>
            <div class="row">
              <div class="body static">
                <span class="text">{m.text}</span>
                {#if m.note}<span class="note">{m.note}</span>{/if}
                <span class="meta">{episodeId ? '' : `${epMap.get(m.episodeId)?.title ?? ''} · `}{formatTime(m.start)}</span>
              </div>
              <button class="pill" onclick={() => restore(m)}>元に戻す</button>
              <button class="icon-btn del" aria-label="完全に削除" onclick={() => purge(m)}><Icon name="trash" /></button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">ゴミ箱は空です。</p>
    {/if}
  {:else}
    <div class="bar">
      {#if episodeId}
        <button class="link" onclick={() => router.go('#/marks')}>すべてのエピソード</button>
      {/if}
      <label class="toggle"><input type="checkbox" bind:checked={showMastered} />習得済み{masteredCount ? `（${masteredCount}）` : ''}</label>
      <button class="link dim" onclick={() => (showTrash = true)}><Icon name="trash" />ゴミ箱{trashed.length ? `（${trashed.length}）` : ''}</button>
    </div>

    <div class="views">
      <div class="seg">
        <button class:on={grouping === 'topic'} onclick={() => (grouping = 'topic')}>話題ごと</button>
        <button class:on={grouping === 'flat'} onclick={() => (grouping = 'flat')}>まとめて</button>
      </div>
      <div class="seg">
        <button class:on={sort === 'time'} onclick={() => (sort = 'time')}>時間順</button>
        <button class:on={sort === 'rating'} onclick={() => (sort = 'rating')}>評価順</button>
        <button class:on={sort === 'new'} onclick={() => (sort = 'new')}>新しい順</button>
      </div>
    </div>

    <div class="filters">
      <button class="chip" class:on={tagFilter === 'all'} onclick={() => (tagFilter = 'all')}>すべて</button>
      {#each MARK_TAGS as t (t.id)}
        <button class="chip tagchip" class:on={tagFilter === t.id} style:--c={t.color} onclick={() => (tagFilter = t.id)}><span class="dot"></span>{t.label}</button>
      {/each}
      <button class="chip" class:on={tagFilter === 'none'} onclick={() => (tagFilter = 'none')}>タグなし</button>
    </div>

    <section class="settings">
      <button class="settings-head" onclick={() => (settingsOpen = !settingsOpen)}>
        <span>連続再生の設定</span><span class="sum">{playlistSummary} {settingsOpen ? '▲' : '▼'}</span>
      </button>
      {#if settingsOpen}
        <div class="opt"><span>回数</span>{#each REPEATS as r}<button class="chip" class:on={playlist.repeat === r} onclick={() => setPlaylist({ repeat: r })}>{r}</button>{/each}</div>
        <div class="opt"><span>間隔</span>{#each GAPS as g}<button class="chip" class:on={playlist.gapSec === g} onclick={() => setPlaylist({ gapSec: g })}>{g}秒</button>{/each}</div>
        <div class="opt"><span>余白</span>{#each PADS as p}<button class="chip" class:on={playlist.padSec === p} onclick={() => setPlaylist({ padSec: p })}>{p}秒</button>{/each}</div>
        <p class="hint">各箇所を「回数」ずつ、「間隔」の無音をはさんで順番に再生します。「余白」は各箇所の前後に足す長さです（前後の単語には食い込みません）。</p>
      {/if}
    </section>

    {#if $marks && allVisible.length === 0}
      <p class="empty">
        表示するマークがありません。<br />
        プレイヤーで文を長押しして［マーク］を押すと追加できます。
      </p>
    {/if}

    {#each groups as g (g.key)}
      <section class="group">
        {#if g.title}<h2>{g.title}</h2>{/if}
        <div class="group-head">
          <h3>{g.subtitle ?? ''}</h3>
          <button class="pill primary small" onclick={() => play(g.marks, 0)}><Icon name="play" />{g.marks.length}箇所を連続再生</button>
        </div>
        <ul>
          {#each g.marks as m (m.id)}
            <li class:mastered={m.mastered} class:open={editing === m.id} class:playing={markPlayer.current?.id === m.id} style:--mc={markColor(m)}>
              {#if editing === m.id}
                <MarkEditor mark={m} transcript={transcripts.get(m.episodeId) ?? null} onClose={() => (editing = null)} onMessage={showToast} />
              {:else}
                <div class="row">
                  {#if selecting}
                    <button class="check" class:on={selected.has(m.id)} aria-label="選択" onclick={() => toggleSelect(m.id)}>
                      {#if selected.has(m.id)}<Icon name="check" />{/if}
                    </button>
                  {/if}
                  <button class="body" onclick={() => (selecting ? toggleSelect(m.id) : (editing = m.id))}>
                    <span class="text">{m.text}</span>
                    {#if m.note}<span class="note">{m.note}</span>{/if}
                    <span class="meta">
                      {#if m.rating}<Stars value={m.rating} />{/if}
                      {#each m.tags ?? [] as t}<span class="tagl" style:--c={TAG_COLOR[t]}>{TAG_LABEL[t]}</span>{/each}
                      {KIND_LABEL[m.kind]} · {formatTime(m.start)}{m.mastered ? ' · 習得済み' : ''}
                    </span>
                  </button>
                  {#if !selecting}
                    <button class="icon-btn go" aria-label="ここだけ再生" onclick={() => play([m], 0)}>
                      <Icon name={markPlayer.current?.id === m.id && engine.playing ? 'pause' : 'play'} />
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}

  <div class="bottom">
    {#if markPlayer.active}
      {@const cur = markPlayer.current}
      <div class="mini" style:--mc={cur ? markColor(cur) : undefined}>
        <div class="mini-text">
          <span class="mini-meta">
            {markPlayer.index + 1}/{markPlayer.queue.length} ·
            {markPlayer.waiting || loop.waiting ? '間隔…' : `${(loop.ab?.played ?? 0) + 1}/${markPlayer.settings.repeat}回`}
          </span>
          <span class="mini-body">{cur?.text}</span>
        </div>
        <div class="mini-ctl">
          <button class="icon-btn" aria-label="前の箇所" onclick={() => markPlayer.step(-1)} disabled={markPlayer.index === 0}><Icon name="prevSentence" /></button>
          <button class="icon-btn" aria-label={engine.playing ? '一時停止' : '再生'} onclick={() => engine.toggle()}><Icon name={engine.playing ? 'pause' : 'play'} /></button>
          <button class="icon-btn" aria-label="次の箇所" onclick={() => markPlayer.step(1)} disabled={markPlayer.index >= markPlayer.queue.length - 1}><Icon name="nextSentence" /></button>
          <button class="pill" onclick={() => cur && openInPlayer(cur)}>全文で開く</button>
          <button class="icon-btn" aria-label="再生をやめる" onclick={() => { markPlayer.stop(); engine.pause(); }}><Icon name="close" /></button>
        </div>
      </div>
    {/if}
    {#if selecting && !showTrash}
      <div class="selbar">
        <span>{selected.size} 件選択</span>
        <button class="pill" onclick={() => (selected = new Set(allVisible.map((m) => m.id)))}>すべて</button>
        <button class="pill" onclick={() => play(selectedMarks(), 0)} disabled={!selected.size}><Icon name="play" />連続再生</button>
        <button class="pill primary" onclick={() => copy(selectedMarks())} disabled={!selected.size}>コピー</button>
      </div>
    {/if}
  </div>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>

<style>
  .page {
    min-height: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: calc(var(--safe-top) + 4px) 16px calc(var(--safe-bottom) + 170px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0 8px;
  }
  h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .link {
    color: var(--accent);
    font-size: 13px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .settings {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 10px 12px;
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .opt span {
    width: 32px;
    flex: none;
    font-size: 12px;
    color: var(--text-dim);
  }
  .chip {
    flex: 1;
    height: 28px;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .chip.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .hint {
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-faint);
  }
  .empty {
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.7;
    text-align: center;
    margin-top: 32px;
  }
  .group {
    margin-bottom: 16px;
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 0;
  }
  h2 {
    font-size: 14px;
    margin: 0;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-top: 1px solid var(--line);
  }
  li.open {
    background: var(--surface);
    border-radius: 10px;
    padding: 10px 12px;
    margin: 6px 0;
    border-top: 0;
  }
  li.mastered .text {
    color: var(--text-faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .check {
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line);
    display: grid;
    place-items: center;
    color: #000;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .check :global(svg) {
    width: 14px;
    height: 14px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 3px;
    text-align: left;
    padding: 10px 0;
  }
  .text {
    font-family: var(--reading);
    font-size: 16px;
    line-height: 1.45;
  }
  .note {
    font-size: 13px;
    color: var(--text-dim);
    white-space: pre-wrap;
  }
  .meta {
    font-size: 11px;
    color: var(--text-faint);
  }
  .go {
    color: var(--text-dim);
  }
  .go :global(svg) {
    width: 18px;
    height: 18px;
  }
  .filters {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin-bottom: 10px;
    scrollbar-width: none;
  }
  .filters .chip {
    flex: none;
    padding: 0 12px;
  }
  .tagl {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    border-radius: 8px;
    background: rgba(255, 158, 203, 0.16);
    color: #ffc2de;
  }
  li.playing {
    background: rgba(255, 158, 203, 0.08);
    border-radius: 8px;
  }
  .bottom {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding-bottom: var(--safe-bottom);
  }
  .bottom:empty {
    display: none;
  }
  .mini {
    padding: 8px 12px 4px;
  }
  .mini-text {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .mini-meta {
    flex: none;
    font-size: 12px;
    color: #ff9ecb;
    font-variant-numeric: tabular-nums;
  }
  .mini-body {
    font-family: var(--reading);
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-ctl {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .mini-ctl .pill {
    margin-left: auto;
  }
  .selbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }
  .selbar span {
    margin-right: auto;
  }
  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--safe-bottom) + 150px);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 8px 14px;
    font-size: 13px;
    white-space: nowrap;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  }

  .link.dim {
    color: var(--text-dim);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .link.dim :global(svg) {
    width: 14px;
    height: 14px;
  }
  .views {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .seg {
    display: inline-flex;
    background: var(--surface);
    border-radius: 10px;
    padding: 2px;
  }
  .seg button {
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .seg button.on {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
  }
  .tagchip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .tagchip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .tagchip.on {
    color: var(--c);
    background: color-mix(in srgb, var(--c) 18%, transparent);
  }
  .settings-head {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: 13px;
  }
  .settings-head .sum {
    color: var(--text-dim);
    font-size: 12px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill.small {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
    flex: none;
  }
  .pill.small :global(svg) {
    width: 14px;
    height: 14px;
  }
  .pill.danger {
    color: var(--danger);
  }
  li {
    border-left: 3px solid var(--mc, transparent);
    padding-left: 10px;
  }
  /* 再生中の項目 */
  li.playing {
    background: color-mix(in srgb, var(--mc) 22%, transparent);
    border-radius: 0 10px 10px 0;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc) 60%, transparent);
  }
  li.playing .text {
    color: #fff;
  }
  .tagl {
    background: color-mix(in srgb, var(--c) 20%, transparent) !important;
    color: var(--c) !important;
  }
  .body.static {
    cursor: default;
  }
  .trash-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .del {
    color: var(--text-faint);
  }
  .mini {
    border-top: 3px solid var(--mc, transparent);
  }
  .mini-meta {
    color: var(--mc, #ff9ecb) !important;
  }
</style>
