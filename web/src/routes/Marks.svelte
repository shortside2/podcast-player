<script lang="ts">
  import { liveQuery } from 'dexie';
  import { onDestroy, onMount } from 'svelte';
  import { PlaybackEngine } from '../lib/playback/engine.svelte';
  import { LoopController } from '../lib/playback/loop.svelte';
  import { MarkPlayer } from '../lib/playback/markPlayer.svelte';
  import { connectMediaSession } from '../lib/playback/mediaSession';
  import { Transcript } from '../lib/transcript/transcript';
  import Icon from '../components/Icon.svelte';
  import MarkEditor from '../components/MarkEditor.svelte';
  import { db, type Episode, type Mark } from '../lib/db/db';
  import { formatTime } from '../lib/format';
  import { KIND_LABEL, MARK_TAGS, TAG_LABEL, loadPlaylistSettings, marksToText, savePlaylistSettings } from '../lib/marks';
  import { router } from '../lib/router.svelte';
  import { sendToClaude } from '../lib/share';

  let { episodeId }: { episodeId: string | null } = $props();

  const REPEATS = [1, 2, 3, 5];
  const GAPS = [0, 0.5, 1, 2, 3];
  const PADS = [0, 0.3, 0.5, 1];

  // svelte-ignore state_referenced_locally
  const marks = liveQuery(() => (episodeId ? db.marks.where('episodeId').equals(episodeId).toArray() : db.marks.toArray()));
  const episodes = liveQuery(() => db.episodes.toArray());

  let showMastered = $state(false);
  let selecting = $state(false);
  let selected = $state<Set<string>>(new Set());
  let editing = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let playlist = $state(loadPlaylistSettings());
  /** 絞り込み: 'all' / タグの id / 'none'（タグなし） */
  let tagFilter = $state<string>('all');

  // ---- この画面の中での再生（全文に戻らずに聞く） ----
  const engine = new PlaybackEngine();
  const transcripts = new Map<string, Transcript>();
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

  /** エピソードの音声とスクリプトを読み込む（すでに読み込んでいれば何もしない） */
  async function ensureLoaded(epId: string): Promise<boolean> {
    if (loadedEpisode === epId) return true;
    const [ep, audio, tr] = await Promise.all([db.episodes.get(epId), db.audioBlobs.get(epId), db.transcripts.get(epId)]);
    if (!ep || !audio) return false;
    if (tr) transcripts.set(epId, new Transcript(tr.doc));
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

  async function copyAll() {
    const list = groups.flatMap((g) => g.marks);
    if (!list.length) return showToast('コピーするマークがありません');
    try {
      await navigator.clipboard.writeText(marksToText(list));
      showToast(`${list.length} 件をコピーしました`);
    } catch {
      showToast('コピーできませんでした');
    }
  }

  const epMap = $derived(new Map(($episodes ?? []).map((e) => [e.id, e])));

  // エピソードごとにまとめ、エピソードの中は時刻順
  const groups = $derived.by(() => {
    const list = ($marks ?? []).filter(
      (m) =>
        (showMastered || !m.mastered) &&
        (tagFilter === 'all' || (tagFilter === 'none' ? !(m.tags?.length) : m.tags?.includes(tagFilter))),
    );
    const byEp = new Map<string, Mark[]>();
    for (const m of list) {
      if (!byEp.has(m.episodeId)) byEp.set(m.episodeId, []);
      byEp.get(m.episodeId)!.push(m);
    }
    return [...byEp.entries()]
      .map(([id, ms]) => ({ episode: epMap.get(id) as Episode | undefined, id, marks: ms.sort((a, b) => a.start - b.start) }))
      .sort((a, b) => (b.episode?.lastPlayedAt ?? 0) - (a.episode?.lastPlayedAt ?? 0));
  });
  const visibleCount = $derived(groups.reduce((n, g) => n + g.marks.length, 0));
  const masteredCount = $derived(($marks ?? []).filter((m) => m.mastered).length);

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
    return groups.flatMap((g) => g.marks).filter((m) => selected.has(m.id));
  }

  async function sendSelected() {
    const list = selectedMarks();
    if (!list.length) return showToast('マークを選んでください');
    const msg = await sendToClaude(marksToText(list));
    if (msg) showToast(msg);
  }

  function setPlaylist(patch: Partial<typeof playlist>) {
    playlist = { ...playlist, ...patch };
    savePlaylistSettings(playlist);
  }
</script>

<div class="page">
  <header>
    <button class="icon-btn" aria-label="戻る" onclick={() => router.back(episodeId ? `#/episode/${episodeId}` : '#/')}><Icon name="chevron-left" /></button>
    <h1>{episodeId ? (epMap.get(episodeId)?.title ?? 'マーク') : 'すべてのマーク'}</h1>
    <button class="pill" onclick={copyAll}>すべてコピー</button>
    <button class="pill" class:on={selecting} onclick={() => { selecting = !selecting; selected = new Set(); }}>{selecting ? 'やめる' : '選択'}</button>
  </header>

  <div class="bar">
    {#if episodeId}
      <button class="link" onclick={() => router.go('#/marks')}>すべてのエピソードのマークを見る</button>
    {/if}
    <label class="toggle">
      <input type="checkbox" bind:checked={showMastered} />習得済みも表示{masteredCount ? `（${masteredCount}）` : ''}
    </label>
  </div>

  <div class="filters">
    <button class="chip" class:on={tagFilter === 'all'} onclick={() => (tagFilter = 'all')}>すべて</button>
    {#each MARK_TAGS as t (t.id)}
      <button class="chip" class:on={tagFilter === t.id} onclick={() => (tagFilter = t.id)}>{t.label}</button>
    {/each}
    <button class="chip" class:on={tagFilter === 'none'} onclick={() => (tagFilter = 'none')}>タグなし</button>
  </div>

  <section class="settings">
    <div class="opt"><span>回数</span>{#each REPEATS as r}<button class="chip" class:on={playlist.repeat === r} onclick={() => setPlaylist({ repeat: r })}>{r}</button>{/each}</div>
    <div class="opt"><span>間隔</span>{#each GAPS as g}<button class="chip" class:on={playlist.gapSec === g} onclick={() => setPlaylist({ gapSec: g })}>{g}秒</button>{/each}</div>
    <div class="opt"><span>余白</span>{#each PADS as p}<button class="chip" class:on={playlist.padSec === p} onclick={() => setPlaylist({ padSec: p })}>{p}秒</button>{/each}</div>
    <p class="hint">連続再生：各箇所を「回数」ずつ、「間隔」の無音をはさんで順番に再生します。「余白」は各箇所の前後に足す長さです。</p>
  </section>

  {#if $marks && visibleCount === 0}
    <p class="empty">
      マークはまだありません。<br />
      プレイヤーで文を長押しして［マーク］を押すと追加できます。
    </p>
  {/if}

  {#each groups as g (g.id)}
    <section class="group">
      <div class="group-head">
        {#if !episodeId}<h2>{g.episode?.title ?? '（削除されたエピソード）'}</h2>{/if}
        <button class="pill primary" onclick={() => play(g.marks, 0)}><Icon name="play" />この{g.marks.length}箇所を連続再生</button>
      </div>
      <ul>
        {#each g.marks as m (m.id)}
          <li class:mastered={m.mastered} class:open={editing === m.id} class:playing={markPlayer.current?.id === m.id}>
            {#if editing === m.id}
              <MarkEditor mark={m} onClose={() => (editing = null)} onMessage={showToast} />
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
                    {#each m.tags ?? [] as t}<span class="tagl">{TAG_LABEL[t]}</span>{/each}
                    {KIND_LABEL[m.kind]} · {formatTime(m.start)}{m.mastered ? ' · 習得済み' : ''}
                  </span>
                </button>
                {#if !selecting}
                  <button class="icon-btn go" aria-label="ここだけ再生" onclick={() => play([m], 0)}><Icon name="play" /></button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <div class="bottom">
    {#if markPlayer.active}
      {@const cur = markPlayer.current}
      <div class="mini">
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
    {#if selecting}
      <div class="selbar">
        <span>{selected.size} 件選択</span>
        <button class="pill" onclick={() => (selected = new Set(groups.flatMap((g) => g.marks.map((m) => m.id))))}>すべて</button>
        <button class="pill" onclick={() => play(selectedMarks(), 0)} disabled={!selected.size}><Icon name="play" />連続再生</button>
        <button class="pill primary" onclick={sendSelected} disabled={!selected.size}><Icon name="send" />送る</button>
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
</style>
