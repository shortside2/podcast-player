<script lang="ts">
  import Icon from './Icon.svelte';
  import { db, type Mark } from '../lib/db/db';
  import { formatTimePrecise } from '../lib/format';
  import { KIND_LABEL, MARK_TAGS, marksToText } from '../lib/marks';
  import { sendToClaude } from '../lib/share';

  let {
    mark,
    onClose,
    onMessage,
    onDeleted,
  }: {
    mark: Mark;
    onClose: () => void;
    onMessage: (text: string) => void;
    onDeleted?: () => void;
  } = $props();

  // 閉じる途中（入力欄のフォーカスが外れたときなど）でも保存できるよう、開いた時点のマークを控えておく
  // svelte-ignore state_referenced_locally
  const m = mark;
  let note = $state(m.note);
  let mastered = $state(m.mastered);
  let tags = $state<string[]>([...(m.tags ?? [])]);

  async function toggleTag(id: string) {
    tags = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
    await db.marks.update(m.id, { tags: [...tags] });
  }
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

  async function toggleMastered() {
    mastered = !mastered;
    await db.marks.update(m.id, { mastered });
    onMessage(mastered ? '習得済みにしました（一覧から隠れます）' : '習得済みを外しました');
  }

  async function send() {
    const msg = await sendToClaude(marksToText([{ ...m, note, tags }]));
    if (msg) onMessage(msg);
    void saveNote();
  }

  async function remove() {
    if (!confirm('このマークを削除しますか？')) return;
    await db.marks.delete(m.id);
    onMessage('マークを削除しました');
    onDeleted?.();
    onClose();
  }

  async function close() {
    await saveNote();
    onClose();
  }
</script>

<div class="mark-editor">
  <div class="head">
    <span class="kind">{KIND_LABEL[m.kind]}</span>
    <span class="time">{formatTimePrecise(m.start)}</span>
    <button class="done" onclick={close}>完了</button>
  </div>
  <p class="text">{m.text}</p>
  <div class="tags">
    {#each MARK_TAGS as t (t.id)}
      <button class="tag" class:on={tags.includes(t.id)} title={t.hint} onclick={() => toggleTag(t.id)}>{t.label}</button>
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
    <button class="pill" onclick={send}><Icon name="send" />Claudeに送る</button>
    <button class="icon-btn del" aria-label="マークを削除" onclick={remove}><Icon name="trash" /></button>
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
    color: #ff9ecb;
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
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    height: 30px;
    padding: 0 10px;
    border-radius: 15px;
    border: 1px solid var(--line);
    font-size: 13px;
    color: var(--text-dim);
  }
  .tag.on {
    background: rgba(255, 158, 203, 0.18);
    border-color: #ff9ecb;
    color: #ffc2de;
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
    color: var(--text-faint);
  }
</style>
