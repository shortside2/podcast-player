<script lang="ts">
  import Icon from './Icon.svelte';
  import Stars from './Stars.svelte';
  import { db, type Mark } from '../lib/db/db';
  import { formatTimePrecise } from '../lib/format';
  import { KIND_LABEL, MARK_TAGS, marksToText } from '../lib/marks';
  import type { Transcript } from '../lib/transcript/transcript';

  let {
    mark,
    transcript = null,
    onClose,
    onMessage,
  }: {
    mark: Mark;
    /** あれば、マークの範囲を単語単位で直せる */
    transcript?: Transcript | null;
    onClose: () => void;
    onMessage: (text: string) => void;
  } = $props();

  // 閉じる途中（入力欄のフォーカスが外れたときなど）でも保存できるよう、開いた時点のマークを控えておく
  // svelte-ignore state_referenced_locally
  const m = mark;
  let note = $state(m.note);
  let mastered = $state(m.mastered);
  let tags = $state<string[]>([...(m.tags ?? [])]);
  let rating = $state(m.rating ?? 0);
  let first = $state(m.firstWord);
  let last = $state(m.lastWord);
  let text = $state(m.text);
  let kind = $state(m.kind);
  let savedNote = m.note;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function onNoteInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNote, 400);
  }

  async function saveNote() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (note === savedNote) return;
    savedNote = note;
    await db.marks.update(m.id, { note });
  }

  async function toggleTag(id: string) {
    tags = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
    await db.marks.update(m.id, { tags: [...tags] });
  }

  async function setRating(v: number) {
    rating = v;
    await db.marks.update(m.id, { rating: v });
  }

  async function toggleMastered() {
    mastered = !mastered;
    await db.marks.update(m.id, { mastered });
    onMessage(mastered ? '習得済みにしました（一覧から隠れます）' : '習得済みを外しました');
  }

  /** 範囲の始まり・終わりを 1 語ずつ動かす */
  async function adjust(which: 'first' | 'last', dir: -1 | 1) {
    const tx = transcript;
    if (!tx) return;
    let a = first;
    let b = last;
    if (which === 'first') a = Math.min(Math.max(0, a + dir), b);
    else b = Math.max(Math.min(tx.words.length - 1, b + dir), a);
    if (a === first && b === last) return;
    first = a;
    last = b;
    text = tx.words.slice(a, b + 1).map((w) => w.text).join(' ');
    const sa = tx.sentences[tx.sentenceOfWord(a)];
    const sb = tx.sentences[tx.sentenceOfWord(b)];
    kind = a === b ? 'word' : sa.firstWord === a && sb.lastWord === b ? 'sentence' : 'range';
    await db.marks.update(m.id, { firstWord: a, lastWord: b, text, kind, start: tx.aPointForWord(a), end: tx.bPointForWord(b) });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(marksToText([{ ...m, text, note, tags }]));
      onMessage('コピーしました');
    } catch {
      onMessage('コピーできませんでした');
    }
    void saveNote();
  }

  async function trash() {
    await saveNote();
    await db.marks.update(m.id, { deletedAt: Date.now() });
    onMessage('ゴミ箱に入れました（マーク一覧の「ゴミ箱」から戻せます）');
    onClose();
  }

  async function close() {
    await saveNote();
    onClose();
  }
</script>

<div class="mark-editor">
  <div class="head">
    <span class="kind">{KIND_LABEL[kind]}</span>
    <span class="time">{formatTimePrecise(transcript ? transcript.aPointForWord(first) : m.start)}</span>
    <Stars value={rating} onChange={setRating} />
    <button class="done" onclick={close}>完了</button>
  </div>

  <p class="text">{text}</p>

  {#if transcript}
    <div class="adjust">
      <span>始め</span>
      <button aria-label="始めを1語前へ" onclick={() => adjust('first', -1)}>◀</button>
      <button aria-label="始めを1語後へ" onclick={() => adjust('first', 1)}>▶</button>
      <span class="sep"></span>
      <span>終わり</span>
      <button aria-label="終わりを1語前へ" onclick={() => adjust('last', -1)}>◀</button>
      <button aria-label="終わりを1語後へ" onclick={() => adjust('last', 1)}>▶</button>
    </div>
  {/if}

  <div class="tags">
    {#each MARK_TAGS as t (t.id)}
      <button class="tag" class:on={tags.includes(t.id)} style:--c={t.color} title={t.hint} onclick={() => toggleTag(t.id)}>
        <span class="dot"></span>{t.label}
      </button>
    {/each}
  </div>

  <textarea
    bind:value={note}
    oninput={onNoteInput}
    onblur={saveNote}
    rows="2"
    placeholder="メモ（意味・気づき・聞き取れなかった理由など）"></textarea>

  <div class="actions">
    <button class="pill" class:on={mastered} onclick={toggleMastered}>{mastered ? '✓ 習得済み' : '習得済みにする'}</button>
    <button class="pill" onclick={copy}>コピー</button>
    <button class="pill del" onclick={trash}><Icon name="trash" />ゴミ箱へ</button>
  </div>
</div>

<style>
  .mark-editor {
    display: grid;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .kind {
    font-weight: 700;
    color: var(--text-dim);
  }
  .time {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
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
    font-size: 16px;
    line-height: 1.5;
    max-height: 5.5em;
    overflow-y: auto;
  }
  .adjust {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .adjust button {
    width: 36px;
    height: 30px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 12px;
  }
  .sep {
    width: 14px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 15px;
    border: 1px solid var(--line);
    font-size: 13px;
    color: var(--text-dim);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .tag.on {
    border-color: var(--c);
    color: var(--c);
    background: color-mix(in srgb, var(--c) 18%, transparent);
  }
  textarea {
    width: 100%;
    resize: vertical;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 10px;
    font: inherit;
    /* 16px 未満だと iPhone で入力時に画面が拡大されてしまう */
    font-size: 16px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions .pill {
    padding: 0 12px;
    font-size: 13px;
  }
  .del {
    margin-left: auto;
    color: var(--text-dim);
  }
  .del :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
