<script lang="ts">
  import { liveQuery } from 'dexie';
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { db, deleteEpisode, type Episode } from '../lib/db/db';
  import { formatBytes, formatDate, formatTime } from '../lib/format';
  import { importFiles } from '../lib/import/importEpisodes';
  import { exportBackup, importBackup } from '../lib/backup';
  import { saveFile } from '../lib/share';
  import { isIOS, isStandalone } from '../lib/platform';
  import { buildLabel } from '../lib/pwa';
  import { router } from '../lib/router.svelte';

  const episodes = liveQuery(() => db.episodes.orderBy('createdAt').reverse().toArray());

  let fileInput: HTMLInputElement;
  let backupInput: HTMLInputElement;
  const markCount = liveQuery(() => db.marks.filter((m) => !m.mastered).count());
  let busy = $state(false);
  let messages = $state<string[]>([]);
  let storage = $state<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const showInstallHint = isIOS() && !isStandalone();

  async function refreshStorage() {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (est) storage = { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
    } catch {
      storage = null;
    }
  }

  onMount(() => {
    void refreshStorage();
  });

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    busy = true;
    messages = [];
    try {
      const res = await importFiles(files);
      messages = [
        ...(res.imported.length ? [`${res.imported.length} 件のエピソードを取り込みました`] : []),
        ...res.messages,
      ];
      if (res.imported.length === 1 && res.messages.length === 0) router.go(`#/episode/${res.imported[0]}`);
    } finally {
      busy = false;
      void refreshStorage();
    }
  }

  async function backup() {
    const { name, text, counts } = await exportBackup();
    await saveFile(name, text);
    messages = [`バックアップを書き出しました（${counts}）`];
  }

  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    messages = await importBackup(await file.text());
  }

  async function remove(ep: Episode) {
    if (!confirm(`「${ep.title}」を削除しますか？\n音声・スクリプト・この回のマークや範囲もすべて消えます。`)) return;
    await deleteEpisode(ep.id);
    void refreshStorage();
  }
</script>

<div class="page">
  <header>
    <h1>ListenLoop</h1>
    <button class="pill" onclick={() => router.go('#/marks')}><Icon name="bookmark" />マーク{$markCount ? ` ${$markCount}` : ''}</button>
    <button class="pill primary" onclick={() => fileInput.click()} disabled={busy}>
      <Icon name="import" />{busy ? '取り込み中…' : '取り込む'}
    </button>
    <!-- iOS では accept を細かく指定すると .json が選べないことがあるため、指定しない -->
    <input bind:this={fileInput} type="file" multiple hidden onchange={onFiles} />
  </header>

  {#if showInstallHint}
    <section class="notice">
      <strong>ホーム画面に追加して使ってください</strong>
      <p>
        Safari で開いたページと、ホーム画面に追加したアプリでは、保存場所が別になります。
        取り込みはホーム画面のアプリから行ってください。
      </p>
      <p class="steps">共有ボタン <span aria-hidden="true">⬆︎</span> →「ホーム画面に追加」</p>
    </section>
  {/if}

  {#if messages.length}
    <section class="messages" aria-live="polite">
      {#each messages as m}<p>{m}</p>{/each}
      <button class="dismiss" onclick={() => (messages = [])}>閉じる</button>
    </section>
  {/if}

  {#if $episodes && $episodes.length === 0}
    <section class="empty">
      <p>エピソードがありません。</p>
      <p class="dim">
        Mac のツールで作った <b>音声（.m4a）</b> と <b>スクリプト（.json）</b> を、
        「取り込む」から2つ同時に選んでください。複数エピソードをまとめて選ぶこともできます。
        スクリプトを作り直したときは、.json だけを選べば更新できます。
      </p>
    </section>
  {/if}

  <ul class="list">
    {#each $episodes ?? [] as ep (ep.id)}
      {@const progress = ep.duration ? Math.min(1, ep.lastPosition / ep.duration) : 0}
      <li>
        <a class="row" href={`#/episode/${ep.id}`}>
          <span class="title">{ep.title}</span>
          <span class="meta">
            {formatTime(ep.duration)} · {ep.wordCount.toLocaleString()} 語 · {formatDate(ep.lastPlayedAt)}
            {#if ep.lastPosition > 0}· 続き {formatTime(ep.lastPosition)}{/if}
          </span>
          <span class="bar"><span style:width={`${progress * 100}%`}></span></span>
        </a>
        <button class="icon-btn del" aria-label="削除" onclick={() => remove(ep)}><Icon name="trash" /></button>
      </li>
    {/each}
  </ul>

  <section class="backup">
    <h2>バックアップ</h2>
    <p>範囲・マーク・メモを 1 つのファイルに書き出します。iPhone の容量が足りなくなると保存データが消されることがあるので、ときどき書き出しておくと安心です（音声とスクリプトは含みません）。</p>
    <div class="row">
      <button class="pill" onclick={backup}>書き出す</button>
      <button class="pill" onclick={() => backupInput.click()}>読み込む</button>
      <input bind:this={backupInput} type="file" hidden onchange={restore} />
    </div>
  </section>

  {#if storage}
    <footer>
      使用量 {formatBytes(storage.usage)}
      {#if storage.quota}/ 上限 約 {formatBytes(storage.quota)}{/if}
      · {storage.persisted ? '永続化 ✓' : '永続化 未許可'}
    </footer>
  {/if}
  <footer class="ver">アプリの版 {buildLabel}</footer>
</div>

<style>
  .page {
    min-height: 100%;
    padding: calc(var(--safe-top) + 8px) 16px calc(var(--safe-bottom) + 24px);
    max-width: 720px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 0 16px;
  }
  h1 {
    flex: 1;
    font-size: 26px;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .notice,
  .messages,
  .empty {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 16px;
    font-size: 14px;
    line-height: 1.6;
  }
  .notice {
    border-color: rgba(245, 185, 66, 0.4);
  }
  .notice p,
  .messages p,
  .empty p {
    margin: 6px 0 0;
  }
  .notice .steps {
    color: var(--accent);
  }
  .messages p:first-child,
  .empty p:first-child {
    margin-top: 0;
  }
  .dismiss {
    margin-top: 8px;
    color: var(--accent);
    font-size: 14px;
  }
  .dim {
    color: var(--text-dim);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--line);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
    padding: 14px 0;
    color: inherit;
    text-decoration: none;
  }
  .title {
    font-size: 17px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 13px;
    color: var(--text-dim);
  }
  .bar {
    height: 3px;
    background: var(--surface-2);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .del {
    color: var(--text-faint);
  }
  .backup {
    margin-top: 28px;
    font-size: 13px;
    color: var(--text-dim);
    line-height: 1.6;
  }
  .backup h2 {
    font-size: 14px;
    color: var(--text);
    margin: 0 0 4px;
  }
  .backup p {
    margin: 0 0 8px;
  }
  .backup .row {
    display: flex;
    gap: 8px;
  }
  footer.ver {
    margin-top: 6px;
  }
  footer {
    margin-top: 24px;
    font-size: 12px;
    color: var(--text-faint);
    text-align: center;
  }
</style>
