<script lang="ts">
  import { liveQuery } from 'dexie';
  import Icon from './Icon.svelte';
  import { dialog } from '../lib/dialog.svelte';
  import { db, type SavedRange } from '../lib/db/db';
  import { formatTime, formatTimePrecise } from '../lib/format';
  import type { TranscriptTopic } from '../lib/transcript/types';

  let {
    episodeId,
    activeIds,
    topics,
    onTopic,
    onTopicRange,
    onOpen,
    onNewSection,
    onSentenceAB,
  }: {
    episodeId: string;
    activeIds: (string | null)[];
    topics: TranscriptTopic[];
    onTopic: (index: number) => void;
    /** 話題 a〜b（両端を含む）をまとめて 1 つの区間にする */
    onTopicRange: (a: number, b: number) => void;
    onOpen: (r: SavedRange, parent: SavedRange | null) => void;
    onNewSection: () => void;
    onSentenceAB: () => void;
  } = $props();

  // 複数の話題をまとめるモード: 始めの話題 → 終わりの話題の順にタップする
  let multi = $state(false);
  let pickA = $state<number | null>(null);
  let pickB = $state<number | null>(null);
  const picked = $derived(pickA == null ? null : pickB == null ? [pickA, pickA] : [Math.min(pickA, pickB), Math.max(pickA, pickB)]);

  function setMulti(on: boolean) {
    multi = on;
    pickA = null;
    pickB = null;
  }

  function tapTopic(i: number) {
    if (!multi) return onTopic(i);
    // 1 回目 = 始め、2 回目 = 終わり。3 回目は選び直し（新しい始め）
    if (pickA == null || pickB != null) {
      pickA = i;
      pickB = null;
    } else {
      pickB = i;
    }
  }

  function makeRange() {
    if (!picked) return;
    onTopicRange(picked[0], picked[1]);
    setMulti(false);
  }

  const ranges = liveQuery(() => db.ranges.where('episodeId').equals(episodeId).toArray());

  // 区間ごとに、その中の AB をまとめて表示する。区間に属さない AB は最後にまとめる
  const groups = $derived.by(() => {
    const all = ($ranges ?? []).slice().sort((a, b) => a.start - b.start);
    const sections = all.filter((r) => r.kind === 'section');
    const ids = new Set(sections.map((s) => s.id));
    return {
      sections: sections.map((s) => ({ section: s, abs: all.filter((r) => r.kind === 'ab' && r.parentId === s.id) })),
      loose: all.filter((r) => r.kind === 'ab' && !(r.parentId && ids.has(r.parentId))),
    };
  });

  async function rename(r: SavedRange) {
    const name = await dialog.prompt('名前', r.name);
    if (name == null || !name.trim()) return;
    await db.ranges.update(r.id, { name: name.trim() });
  }

  async function remove(r: SavedRange) {
    const children = r.kind === 'section' ? await db.ranges.where('parentId').equals(r.id).count() : 0;
    const extra = children ? `中の AB リピート ${children} 件は「区間なし」に移ります。` : undefined;
    if (!(await dialog.confirm(`「${r.name}」を削除しますか？`, { message: extra, okLabel: '削除', danger: true }))) return;
    await db.transaction('rw', db.ranges, async () => {
      if (children) await db.ranges.where('parentId').equals(r.id).modify({ parentId: null });
      await db.ranges.delete(r.id);
    });
  }
</script>

{#snippet item(r: SavedRange, nested: boolean)}
  <li class:nested class:active={activeIds.includes(r.id)}>
    <button class="open" onclick={() => onOpen(r, ($ranges ?? []).find((x) => x.id === r.parentId) ?? null)}>
      <span class="kind" class:ab={r.kind === 'ab'}>{r.kind === 'ab' ? 'AB' : '区間'}</span>
      <span class="name">{r.name}</span>
      <span class="meta">
        {formatTimePrecise(r.start)}–{formatTimePrecise(r.end)} · {r.repeatCount === 0 ? '∞' : `${r.repeatCount}回`}{r.gapSec ? ` · 間隔${r.gapSec}秒` : ''}
      </span>
    </button>
    <button class="icon-btn" aria-label="名前を変更" onclick={() => rename(r)}><Icon name="edit" /></button>
    <button class="icon-btn" aria-label="削除" onclick={() => remove(r)}><Icon name="trash" /></button>
  </li>
{/snippet}

<div class="sheet">
  <div class="new">
    <button class="pill" onclick={onSentenceAB}><Icon name="repeat" />今の文で AB</button>
    <button class="pill" onclick={onNewSection}><Icon name="plus" />区間を作る</button>
  </div>
  <p class="hint">文を長押しして選択すると、選んだ範囲で AB リピートや区間を作れます。</p>

  {#if topics.length}
    <div class="topics-head">
      <h3>{multi ? '始めの話題と終わりの話題をタップ' : '話題（タップで区間にする）'}</h3>
      {#if topics.length > 1}
        <button class="chip" class:on={multi} onclick={() => setMulti(!multi)}>{multi ? 'やめる' : '複数の話題をまとめる'}</button>
      {/if}
    </div>
    {#if multi}
      <div class="multibar">
        <span>{picked ? (picked[0] === picked[1] ? `話題 ${picked[0] + 1} から（終わりの話題をタップ）` : `話題 ${picked[0] + 1}〜${picked[1] + 1}`) : '始めの話題をタップ'}</span>
        <button class="pill primary" disabled={!picked} onclick={makeRange}>区間にする</button>
      </div>
    {/if}
    <ul class="topics">
      {#each topics as t, i}
        <li
          class:picked={picked && i >= picked[0] && i <= picked[1]}
          class:edge={picked && (i === picked[0] || i === picked[1])}>
          <button class="open" aria-pressed={multi ? !!(picked && i >= picked[0] && i <= picked[1]) : undefined} onclick={() => tapTopic(i)}>
            <span class="kind">{i + 1}</span>
            <span class="name">{t.titleJa || t.titleEn}</span>
            <span class="meta">{formatTime(t.start)}–{formatTime(t.end)}{t.titleJa && t.titleEn ? ` · ${t.titleEn}` : ''}</span>
          </button>
        </li>
      {/each}
    </ul>
    <h3>保存した範囲</h3>
  {/if}

  {#if $ranges && $ranges.length === 0}
    <p class="empty">保存した範囲はまだありません。</p>
  {/if}

  <ul>
    {#each groups.sections as g (g.section.id)}
      {@render item(g.section, false)}
      {#each g.abs as ab (ab.id)}
        {@render item(ab, true)}
      {/each}
    {/each}
    {#if groups.loose.length && groups.sections.length}
      <li class="divider">区間なし</li>
    {/if}
    {#each groups.loose as ab (ab.id)}
      {@render item(ab, false)}
    {/each}
  </ul>
</div>

<style>
  .sheet {
    max-height: 45vh;
    overflow-y: auto;
  }
  .new {
    display: flex;
    gap: 8px;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    margin: 14px 0 4px;
  }
  .topics-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 14px 0 4px;
  }
  .topics-head h3 {
    margin: 0;
  }
  .chip {
    flex: none;
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .chip.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .multibar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    background: var(--surface);
    font-size: 13px;
  }
  .multibar span {
    flex: 1;
    min-width: 0;
  }
  /* まとめる範囲に入っている話題 */
  .topics li.picked {
    background: var(--accent-soft);
  }
  .topics li.picked .kind {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .topics li.picked + li.picked {
    border-top-color: transparent;
  }
  .topics li.edge .name {
    color: var(--accent);
    font-weight: 600;
  }
  .topics .open {
    padding-left: 4px;
  }
  .topics .meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint,
  .empty {
    font-size: 12px;
    color: var(--text-dim);
    margin: 8px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    border-top: 1px solid var(--line);
  }
  li.nested {
    padding-left: 18px;
  }
  li.active .name {
    color: var(--accent);
  }
  .divider {
    font-size: 12px;
    color: var(--text-faint);
    padding: 10px 0 4px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    row-gap: 2px;
    text-align: left;
    padding: 8px 0;
  }
  .kind {
    grid-row: span 2;
    align-self: center;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--accent);
  }
  .kind.ab {
    color: #8ab8ff;
  }
  .name {
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .icon-btn {
    width: 40px;
    height: 40px;
    color: var(--text-faint);
  }
  .icon-btn :global(svg) {
    width: 20px;
    height: 20px;
  }
</style>
