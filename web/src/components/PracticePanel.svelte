<script lang="ts">
  import { liveQuery } from 'dexie';
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { db, type Recording } from '../lib/db/db';
  import { dialog } from '../lib/dialog.svelte';
  import { Practice, type PracticeTarget } from '../lib/playback/practice.svelte';
  import { saveBlob } from '../lib/share';

  let {
    practice,
    target,
    text,
    onClose,
  }: {
    practice: Practice;
    target: PracticeTarget;
    /** 練習する英文（表示用） */
    text: string;
    onClose: () => void;
  } = $props();

  const COMPARE_TIMES = [1, 2, 3];
  let times = $state(1);
  let playingId = $state<string | null>(null);

  // この範囲（記録から開いたときはその記録）の録音
  // svelte-ignore state_referenced_locally
  const t = target;
  const recordings = liveQuery(() =>
    db.recordings
      .where('episodeId')
      .equals(t.episodeId)
      // 記録から録ったもの、または同じ範囲で録ったもの（AB リピートから録った録音も含める）
      .filter((r) => (!!t.markId && r.markId === t.markId) || (Math.abs(r.start - t.start) < 0.05 && Math.abs(r.end - t.end) < 0.05))
      .toArray()
      .then((rs) => rs.sort((a, b) => b.createdAt - a.createdAt)),
  );

  onDestroy(() => practice.cancel());

  async function record() {
    playingId = null;
    await practice.recordAfterModel(t);
  }

  async function mine(r: Recording) {
    practice.cancel();
    playingId = r.id;
    await practice.playMine(r);
    if (playingId === r.id) playingId = null;
  }

  async function compare(r: Recording) {
    playingId = r.id;
    await practice.compare(t, r, times);
    if (playingId === r.id) playingId = null;
  }

  function stop() {
    practice.cancel();
    playingId = null;
  }

  async function remove(r: Recording) {
    if (!(await dialog.confirm('この録音を削除しますか？', { okLabel: '削除', danger: true }))) return;
    await db.recordings.delete(r.id);
  }

  /** 録音をファイルとして保存・送信（iPhone では共有シート） */
  async function exportRec(r: Recording) {
    const d = new Date(r.createdAt);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const words = text.replace(/[^A-Za-z0-9' ]/g, '').trim().split(/\s+/).slice(0, 6).join('-');
    const ext = r.mimeType.includes('webm') ? 'webm' : 'm4a';
    await saveBlob(`listenloop-${stamp}-${words || 'recording'}.${ext}`, r.blob);
  }

  function label(r: Recording): string {
    const d = new Date(r.createdAt);
    const time = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return r.duration ? `${time} · ${r.duration.toFixed(1)}秒` : time;
  }
</script>

<div class="practice">
  <div class="head">
    <span class="title"><Icon name="mic" />発音練習</span>
    <button class="done" onclick={() => { practice.cancel(); onClose(); }}>閉じる</button>
  </div>
  <p class="text">{text}</p>

  {#if !Practice.supported()}
    <p class="error">このブラウザでは録音できません（https で開いたホーム画面のアプリで使えます）。</p>
  {:else}
    <div class="main">
      {#if practice.state === 'recording'}
        <button class="rec on" onclick={() => practice.stopRecording()}>
          <span class="dot"></span>録音中 {practice.elapsed.toFixed(1)} / {practice.limit.toFixed(1)}秒 — 止める
        </button>
      {:else if practice.state === 'model'}
        <button class="rec" onclick={stop}><Icon name="pause" />お手本を再生中… 止める</button>
      {:else}
        <button class="rec" onclick={record}><Icon name="mic" />お手本 → 録音</button>
        <button class="pill" onclick={() => practice.playModel(t)}><Icon name="play" />お手本</button>
      {/if}
    </div>
    <p class="hint">お手本が 1 回流れたあと、自動で録音が始まります。お手本の長さに合わせて自動で止まります。</p>
  {/if}
  {#if practice.error}<p class="error">{practice.error}</p>{/if}

  {#if $recordings?.length}
    <div class="list-head">
      <span>録音 {$recordings.length}</span>
      <span class="times">
        聴き比べ
        {#each COMPARE_TIMES as n}
          <button class="chip" class:on={times === n} onclick={() => (times = n)}>×{n}</button>
        {/each}
      </span>
    </div>
    <ul>
      {#each $recordings as r, i (r.id)}
        <li class:playing={playingId === r.id}>
          <span class="no">{$recordings.length - i}</span>
          <span class="when">{label(r)}</span>
          {#if playingId === r.id && practice.busy}
            <button class="pill small" onclick={stop}><Icon name="pause" />止める</button>
          {:else}
            <button class="pill small" onclick={() => mine(r)}><Icon name="play" />自分</button>
            <button class="pill small primary" onclick={() => compare(r)}>お手本→自分</button>
          {/if}
          <button class="icon-btn del" aria-label="録音を保存・送る" onclick={() => exportRec(r)}><Icon name="share" /></button>
          <button class="icon-btn del" aria-label="録音を削除" onclick={() => remove(r)}><Icon name="trash" /></button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .practice {
    display: grid;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    color: #ff8a8a;
  }
  .title :global(svg) {
    width: 16px;
    height: 16px;
  }
  .done {
    margin-left: auto;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
  }
  .text {
    margin: 0;
    font-family: var(--reading);
    font-size: 15px;
    line-height: 1.45;
    max-height: 4.4em;
    overflow-y: auto;
  }
  .main {
    display: flex;
    gap: 8px;
  }
  .rec {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 44px;
    border-radius: 22px;
    background: #ff5a5a;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }
  .rec.on {
    background: #7a1f1f;
  }
  .rec :global(svg) {
    width: 18px;
    height: 18px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff5a5a;
    animation: blink 1s infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.2;
    }
  }
  .main .pill {
    height: 44px;
    border-radius: 22px;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint);
  }
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
  }
  .times {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .chip {
    height: 26px;
    min-width: 34px;
    border-radius: 13px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .chip.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 30vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  li.playing {
    background: rgba(255, 90, 90, 0.1);
  }
  .no {
    width: 18px;
    color: var(--text-faint);
    text-align: right;
  }
  .when {
    flex: 1;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .pill.small {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
  }
  .pill.small :global(svg) {
    width: 14px;
    height: 14px;
  }
  .del {
    width: 34px;
    height: 34px;
    color: var(--text-faint);
  }
  .del :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
