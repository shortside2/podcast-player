<script lang="ts">
  import Icon from './Icon.svelte';
  import { dialog } from '../lib/dialog.svelte';
  import type { TranslationRow } from '../lib/db/db';
  import { exportSentencesForTranslation, parseTranslationInput, type ParseResult, type Translations } from '../lib/transcript/translation';
  import { deleteTranslations, mergeTranslations } from '../lib/transcript/translationStore';
  import type { TranscriptDoc } from '../lib/transcript/types';

  let {
    episodeId,
    doc,
    row,
    translations,
    onChanged,
    onClose,
    onMessage,
  }: {
    episodeId: string;
    doc: TranscriptDoc;
    /** 取り込んだ訳データ（なければ null） */
    row: TranslationRow | null;
    translations: Translations;
    /** 訳データを取り込んだ・消したあと（呼び出し側で表示を描き直す） */
    onChanged: () => Promise<void> | void;
    onClose: () => void;
    onMessage: (text: string) => void;
  } = $props();

  // Claude に頼むときの依頼文（「依頼文をつける」をオンにしたとき先頭に入れる）
  const REQUEST = [
    '次の英文を、1 行ずつ自然な日本語に訳してください。',
    '各行の先頭の [ID] はそのまま残し、「[ID] 訳文」の形で 1 行に 1 文ずつ返してください。',
    '行を結合・分割したり、説明を付け足したりしないでください。',
    '',
  ].join('\n');

  const total = $derived(doc.sentences.length);
  const importedCount = $derived(Object.keys(row?.sentences ?? {}).length);
  const missing = $derived(total - translations.sentenceLevelCount);
  const scriptChanged = $derived(!!row && row.sentenceCount !== total);
  const source = $derived(
    importedCount
      ? `取り込んだ訳 ${importedCount} 文`
      : translations.hasSentenceLevel
        ? 'スクリプトに入っている文ごとの訳'
        : translations.hasAny
          ? 'スクリプトに入っている段落ごとの訳（文ごとには対応していません）'
          : 'なし',
  );

  let withRequest = $state(false);
  let input = $state('');
  let result = $state<ParseResult | null>(null);
  let busy = $state(false);

  async function copyForTranslation(onlyMissing: boolean) {
    const { text, count } = exportSentencesForTranslation(doc, translations, onlyMissing);
    if (!count) return onMessage(onlyMissing ? 'すべての文に訳があります' : '書き出す文がありません');
    try {
      await navigator.clipboard.writeText(withRequest ? REQUEST + text : text);
      onMessage(`${count} 文をコピーしました。Claude に貼り付けてください`);
    } catch {
      onMessage('コピーできませんでした');
    }
  }

  async function onFile(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    input = await file.text();
    check();
  }

  function check() {
    if (!input.trim()) {
      result = null;
      return onMessage('訳を貼り付けるか、ファイルを選んでください');
    }
    result = parseTranslationInput(input, total);
  }

  async function doImport() {
    if (!result?.entries.size || busy) return;
    busy = true;
    try {
      const { added, replaced } = await mergeTranslations(episodeId, result.entries, total);
      await onChanged();
      onMessage(`訳を取り込みました（新しく ${added} 文${replaced ? `・上書き ${replaced} 文` : ''}）`);
      input = '';
      result = null;
    } finally {
      busy = false;
    }
  }

  async function remove() {
    const ok = await dialog.confirm('取り込んだ訳データを削除しますか？', {
      message: `この回の取り込んだ訳 ${importedCount} 文を削除します。スクリプトに元から入っている訳や、記録・範囲・録音は消えません。`,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    await deleteTranslations(episodeId);
    await onChanged();
    onMessage('取り込んだ訳データを削除しました');
  }
</script>

<div class="sheet" role="dialog" aria-label="訳データ">
  <header>
    <h2>訳データ</h2>
    <button class="icon-btn" aria-label="閉じる" onclick={onClose}><Icon name="close" /></button>
  </header>

  <div class="body">
    <section class="status">
      <div><span class="k">この回の文</span>{total} 文</div>
      <div><span class="k">今の訳</span>{source}</div>
      {#if translations.hasSentenceLevel}
        <div><span class="k">訳のない文</span>{missing} 文</div>
      {/if}
      {#if scriptChanged}
        <p class="warn">訳データを取り込んだときと文の数が違います（{row?.sentenceCount} → {total}）。スクリプトを差し替えた場合は、ID がずれている可能性があります。書き出し直して訳を作り直してください。</p>
      {/if}
    </section>

    <section>
      <h3>1. 訳の準備用に書き出す</h3>
      <p class="hint">文を「[ID] 英文」の形で 1 行ずつコピーします。Claude に貼り付けて、「[ID] 訳文」の形で返してもらってください。長い回は、何回かに分けて頼んでもかまいません（取り込むたびに足されます）。</p>
      <label class="check"><input type="checkbox" bind:checked={withRequest} />先頭に依頼文をつける</label>
      <div class="row">
        <button class="pill" onclick={() => copyForTranslation(false)}>すべての文をコピー</button>
        {#if translations.hasSentenceLevel && missing > 0}
          <button class="pill" onclick={() => copyForTranslation(true)}>訳のない文だけ（{missing}）</button>
        {/if}
      </div>
    </section>

    <section>
      <h3>2. 訳を取り込む</h3>
      <p class="hint">Claude から返ってきた訳（「[ID] 訳文」のテキスト、または JSON）を貼り付けるか、ファイルを選んでください。</p>
      <textarea bind:value={input} rows="6" placeholder={'[0] 訳文\n[1] 訳文\n…'} oninput={() => (result = null)}></textarea>
      <div class="row">
        <label class="pill file">ファイルを選ぶ<input type="file" accept=".json,.txt,application/json,text/plain" onchange={onFile} /></label>
        <button class="pill primary" onclick={check}>確認する</button>
      </div>

      {#if result}
        <div class="result">
          <p>取り込める訳：<b>{result.entries.size}</b> 文{#if result.errors.length}・エラー <b class="err">{result.errors.length}</b> 件{/if}</p>
          {#if result.errors.length}
            <ul class="errors">
              {#each result.errors.slice(0, 100) as e (e.line + e.reason)}
                <li><span class="ln">{result.format === 'json' ? `${e.line}番目` : `${e.line}行目`}</span><span class="why">{e.reason}</span><span class="src">{e.content}</span></li>
              {/each}
              {#if result.errors.length > 100}<li class="more">ほか {result.errors.length - 100} 件</li>{/if}
            </ul>
            <p class="hint">エラーの行は取り込みません。正しい行だけを取り込めます。</p>
          {/if}
          <button class="pill primary" disabled={!result.entries.size || busy} onclick={doImport}>{result.entries.size} 文を取り込む</button>
        </div>
      {/if}
    </section>

    {#if importedCount}
      <section>
        <h3>取り込んだ訳データ</h3>
        <button class="pill danger" onclick={remove}>削除する</button>
      </section>
    {/if}
  </div>
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    padding: var(--safe-top) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px calc(var(--safe-bottom) + 24px);
    display: grid;
    gap: 14px;
    align-content: start;
  }
  section {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 12px;
    display: grid;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  .status {
    font-size: 13px;
    gap: 4px;
  }
  .k {
    display: inline-block;
    width: 84px;
    color: var(--text-dim);
  }
  .warn {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--danger);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: 16px; /* 16px 未満だと iPhone が入力時に拡大してしまう */
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    resize: vertical;
  }
  .file {
    position: relative;
    overflow: hidden;
  }
  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
  }
  .result {
    display: grid;
    gap: 8px;
    font-size: 13px;
  }
  .result p {
    margin: 0;
  }
  .err {
    color: var(--danger);
  }
  .errors {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 40vh;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .errors li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    padding: 6px 8px;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  .errors li:first-child {
    border-top: 0;
  }
  .ln {
    color: var(--text-dim);
    white-space: nowrap;
  }
  .why {
    color: var(--danger);
  }
  .src {
    grid-column: 2;
    color: var(--text-faint);
    word-break: break-all;
  }
  .more {
    color: var(--text-dim);
  }
  .pill.danger {
    color: var(--danger);
  }
</style>
