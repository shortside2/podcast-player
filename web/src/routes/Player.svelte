<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { db, type Episode } from '../lib/db/db';
  import { formatTime } from '../lib/format';
  import { PlaybackEngine } from '../lib/playback/engine.svelte';
  import { connectMediaSession } from '../lib/playback/mediaSession';
  import { wakeLock } from '../lib/playback/wakeLock.svelte';
  import { router } from '../lib/router.svelte';
  import { Transcript } from '../lib/transcript/transcript';
  import { TranscriptView } from '../lib/transcript/view';

  let { id }: { id: string } = $props();

  // 単語の頭が欠けないよう、少しだけ手前から再生する
  const PREROLL = 0.05;
  const SAVE_INTERVAL_MS = 5000;

  const engine = new PlaybackEngine();
  let episode = $state<Episode | null>(null);
  let transcript: Transcript | null = null;
  let view: TranscriptView | null = null;
  let loadError = $state<string | null>(null);
  let following = $state(true);
  let panel = $state<'none' | 'speed' | 'settings'>('none');
  let timingOffset = $state(0);
  let scrubbing = $state(false);
  let scrubValue = $state(0);

  let scroller: HTMLElement;
  let content: HTMLElement;
  const disposers: (() => void)[] = [];

  onMount(() => {
    void load();
  });

  async function load() {
    const [ep, tr, audio] = await Promise.all([
      db.episodes.get(id),
      db.transcripts.get(id),
      db.audioBlobs.get(id),
    ]);
    if (!ep || !tr || !audio) {
      loadError = 'エピソードが見つかりません';
      return;
    }
    episode = ep;
    timingOffset = ep.timingOffset;
    transcript = new Transcript(tr.doc);
    view = new TranscriptView(scroller, content, transcript, {
      onWordTap: (i) => {
        const w = transcript!.words[i];
        engine.seek(w.start + timingOffset - PREROLL);
        view?.resumeFollow();
        if (!engine.playing) void engine.play();
      },
      onFollowChange: (f) => (following = f),
    });
    view.setTimingOffset(timingOffset);
    disposers.push(engine.onFrame((t) => view?.update(t)));
    engine.load(audio.blob, ep.lastPosition, ep.rate);
    disposers.push(
      connectMediaSession(engine, {
        title: ep.title,
        artworkUrl: new URL('icon-512.png', document.baseURI).href,
        onPrevSentence: prevSentence,
        onNextSentence: nextSentence,
      }),
    );

    // 再生位置の保存: 再生中は 5 秒ごと、一時停止・アプリ切り替え・画面を離れるときにも保存
    const timer = setInterval(() => {
      if (engine.playing) void savePosition();
    }, SAVE_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void savePosition();
    };
    const onPause = () => void savePosition();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPause);
    engine.audio.addEventListener('pause', onPause);
    disposers.push(
      () => clearInterval(timer),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onPause),
      () => engine.audio.removeEventListener('pause', onPause),
    );

    if (wakeLock.enabled) void wakeLock.acquire();
  }

  async function savePosition() {
    if (!episode || !engine.ready) return;
    await db.episodes.update(id, {
      lastPosition: engine.currentTime,
      lastPlayedAt: Date.now(),
      rate: engine.rate,
    });
  }

  onDestroy(() => {
    void savePosition();
    disposers.forEach((d) => d());
    view?.destroy();
    engine.unload();
    void wakeLock.release();
  });

  function sentenceStartTime(si: number): number {
    return transcript!.sentences[si].start + timingOffset - PREROLL;
  }

  function prevSentence() {
    if (!transcript) return;
    const t = engine.currentTime - timingOffset + PREROLL + 0.01;
    const si = transcript.sentenceAt(t);
    if (si < 0) return engine.seek(0);
    // 文の途中（1 秒以上経過）なら文頭へ、文頭付近なら前の文へ
    const target = t - transcript.sentences[si].start > 1 || si === 0 ? si : si - 1;
    engine.seek(sentenceStartTime(target));
    view?.resumeFollow();
  }

  function nextSentence() {
    if (!transcript) return;
    // 文頭より少し手前（PREROLL）から再生しているので、その分を足して「今の文」を判定する
    const si = transcript.sentenceAt(engine.currentTime - timingOffset + PREROLL + 0.01);
    const target = Math.min(si + 1, transcript.sentences.length - 1);
    engine.seek(sentenceStartTime(target));
    view?.resumeFollow();
  }

  function changeRate(delta: number) {
    engine.setRate(engine.rate + delta);
    void savePosition();
  }

  function changeOffset(deltaMs: number) {
    timingOffset = Math.round((timingOffset + deltaMs / 1000) * 1000) / 1000;
    view?.setTimingOffset(timingOffset);
    view?.update(engine.currentTime);
    void db.episodes.update(id, { timingOffset });
  }

  function onKey(e: KeyboardEvent) {
    // Mac のブラウザで確認するときのショートカット
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      engine.toggle();
    } else if (e.key === 'ArrowLeft') engine.skip(-5);
    else if (e.key === 'ArrowRight') engine.skip(5);
    else if (e.key === 'ArrowUp') prevSentence();
    else if (e.key === 'ArrowDown') nextSentence();
  }

  const shownTime = $derived(scrubbing ? scrubValue : engine.time);
</script>

<svelte:window onkeydown={onKey} />

<div class="player">
  <header>
    <button class="icon-btn" aria-label="一覧に戻る" onclick={() => router.go('#/')}><Icon name="chevron-left" /></button>
    <h1>{episode?.title ?? ''}</h1>
    <button
      class="icon-btn"
      class:active={panel === 'settings'}
      aria-label="設定"
      onclick={() => (panel = panel === 'settings' ? 'none' : 'settings')}><Icon name="more" /></button>
  </header>

  <div class="scroller" bind:this={scroller}>
    {#if loadError}
      <p class="error">{loadError}</p>
    {/if}
    <div class="transcript" bind:this={content}></div>
  </div>

  <footer>
    {#if !following}
      <button class="pill primary follow" onclick={() => view?.resumeFollow()}>
        <Icon name="locate" />現在位置に戻る
      </button>
    {/if}
    {#if engine.error}<p class="error">{engine.error}</p>{/if}

    {#if panel === 'speed'}
      <div class="panel">
        <div class="speed-row">
          <button class="icon-btn" aria-label="遅く" onclick={() => changeRate(-0.05)} disabled={engine.rate <= 0.5}><Icon name="minus" /></button>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={engine.rate}
            oninput={(e) => engine.setRate(Number(e.currentTarget.value))}
            onchange={() => void savePosition()}
            aria-label="再生速度" />
          <button class="icon-btn" aria-label="速く" onclick={() => changeRate(0.05)} disabled={engine.rate >= 1.5}><Icon name="plus" /></button>
        </div>
        <div class="presets">
          {#each [0.7, 0.8, 0.9, 1, 1.2] as r}
            <button class="pill" class:on={Math.abs(engine.rate - r) < 0.001} onclick={() => { engine.setRate(r); void savePosition(); }}>{r.toFixed(2)}</button>
          {/each}
        </div>
      </div>
    {:else if panel === 'settings'}
      <div class="panel">
        <div class="setting">
          <div>
            <div class="label">ハイライトのずれ補正</div>
            <div class="hint">ハイライトが音より早いときは＋、遅いときは−</div>
          </div>
          <div class="offset">
            <button class="icon-btn" aria-label="10ミリ秒減らす" onclick={() => changeOffset(-10)}><Icon name="minus" /></button>
            <span>{timingOffset >= 0 ? '+' : ''}{Math.round(timingOffset * 1000)}ms</span>
            <button class="icon-btn" aria-label="10ミリ秒増やす" onclick={() => changeOffset(10)}><Icon name="plus" /></button>
          </div>
        </div>
      </div>
    {/if}

    <div class="seek">
      <span class="time">{formatTime(shownTime)}</span>
      <input
        type="range"
        min="0"
        max={engine.duration || episode?.duration || 0}
        step="0.1"
        value={shownTime}
        oninput={(e) => {
          scrubbing = true;
          scrubValue = Number(e.currentTarget.value);
        }}
        onchange={(e) => {
          engine.seek(Number(e.currentTarget.value));
          scrubbing = false;
          view?.resumeFollow();
        }}
        aria-label="再生位置" />
      <span class="time">-{formatTime((engine.duration || 0) - shownTime)}</span>
    </div>

    <div class="controls">
      <button class="icon-btn" aria-label="前の文" onclick={prevSentence}><Icon name="prev" /></button>
      <button class="icon-btn" aria-label="5秒戻す" onclick={() => engine.skip(-5)}><Icon name="back5" /></button>
      <button class="play" aria-label={engine.playing ? '一時停止' : '再生'} onclick={() => engine.toggle()} disabled={!engine.ready}>
        <Icon name={engine.playing ? 'pause' : 'play'} />
      </button>
      <button class="icon-btn" aria-label="5秒送る" onclick={() => engine.skip(5)}><Icon name="fwd5" /></button>
      <button class="icon-btn" aria-label="次の文" onclick={nextSentence}><Icon name="next" /></button>
    </div>

    <div class="sub">
      <button class="pill" class:on={panel === 'speed'} onclick={() => (panel = panel === 'speed' ? 'none' : 'speed')}>
        速度 {engine.rate.toFixed(2)}×
      </button>
      <button class="pill" class:on={wakeLock.enabled} disabled={!wakeLock.supported} onclick={() => wakeLock.setEnabled(!wakeLock.enabled)}>
        <Icon name="sun" />画面オン
      </button>
    </div>
  </footer>
</div>

<style>
  .player {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(var(--safe-top) + 4px) 8px 4px;
    border-bottom: 1px solid var(--line);
  }
  header h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icon-btn.active {
    color: var(--accent);
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .error {
    color: var(--danger);
    font-size: 14px;
    padding: 0 16px;
  }
  .follow {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(100% + 12px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    z-index: 2;
  }
  footer {
    position: relative;
    border-top: 1px solid var(--line);
    background: var(--bg);
    padding: 8px 16px calc(var(--safe-bottom) + 10px);
  }
  .panel {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 8px 12px;
    margin-bottom: 8px;
  }
  .speed-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    padding: 4px 0 6px;
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }
  .label {
    font-size: 15px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 2px;
  }
  .offset {
    display: flex;
    align-items: center;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
  }
  .offset span {
    min-width: 60px;
    text-align: center;
  }
  .seek {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .time {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    min-width: 48px;
  }
  .time:last-child {
    text-align: right;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 360px;
    margin: 4px auto 6px;
  }
  .play {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--text);
    color: #000;
    display: grid;
    place-items: center;
  }
  .play :global(svg) {
    width: 28px;
    height: 28px;
  }
  .sub {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
</style>
