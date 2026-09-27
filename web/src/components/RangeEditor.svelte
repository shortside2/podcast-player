<script lang="ts">
  import Icon from './Icon.svelte';
  import { dialog } from '../lib/dialog.svelte';
  import { formatTimePrecise, parseTime } from '../lib/format';
  import type { LoopController, RangeKind } from '../lib/playback/loop.svelte';
  import type { Transcript } from '../lib/transcript/transcript';

  let {
    loop,
    kind,
    transcript,
    target = $bindable(),
    onPreview,
    onSave,
  }: {
    loop: LoopController;
    kind: RangeKind;
    transcript: Transcript;
    /** テキストをタップしたときに動かす点 */
    target: 'A' | 'B';
    /** 調整した点を聞いて確かめるために、その付近から再生する */
    onPreview: (t: number) => void;
    onSave: () => void;
  } = $props();

  const COUNTS = [1, 2, 3, 5, 10, 0];
  const GAPS = [0, 0.5, 1, 2, 3];
  const MIN_LEN = 0.3;

  const range = $derived(kind === 'ab' ? loop.ab : loop.section);
  // 区間は大きな範囲なので、単語ではなく文単位・1 秒単位で動かす
  const fine = $derived(kind === 'ab' ? 0.1 : 1);
  const unit = $derived(kind === 'ab' ? '語' : '文');

  function setA(a: number, preview = true) {
    if (!range) return;
    const start = Math.max(0, Math.min(a, range.end - MIN_LEN));
    loop.update(kind, { start });
    if (preview) onPreview(start);
  }

  function setB(b: number, preview = true) {
    if (!range) return;
    const end = Math.min(transcript.duration, Math.max(b, range.start + MIN_LEN));
    loop.update(kind, { end });
    // B 点の直前から再生して、終わり方を確かめられるようにする
    if (preview) onPreview(Math.max(range.start, end - 1.5));
  }

  function stepWord(dir: -1 | 1) {
    if (!range) return;
    const tx = transcript;
    if (target === 'A') {
      const i = tx.wordForAPoint(range.start);
      if (kind === 'ab') {
        if (tx.words[i + dir]) setA(tx.aPointForWord(i + dir));
      } else {
        const s = tx.sentences[tx.sentenceOfWord(i) + dir];
        if (s) setA(tx.aPointForWord(s.firstWord));
      }
    } else {
      const j = tx.wordForBPoint(range.end);
      if (kind === 'ab') {
        if (tx.words[j + dir]) setB(tx.bPointForWord(j + dir));
      } else {
        const s = tx.sentences[tx.sentenceOfWord(j) + dir];
        if (s) setB(tx.bPointForWord(s.lastWord));
      }
    }
  }

  function nudge(delta: number) {
    if (!range) return;
    if (target === 'A') setA(range.start + delta);
    else setB(range.end + delta);
  }

  async function typeTime() {
    if (!range) return;
    const cur = target === 'A' ? range.start : range.end;
    const text = await dialog.prompt(`${target === 'A' ? (kind === 'ab' ? 'A' : '始まり') : kind === 'ab' ? 'B' : '終わり'} の時刻`, formatTimePrecise(cur), { message: '例 1:02.5' });
    if (text == null) return;
    const t = parseTime(text);
    if (t == null) return dialog.alert('時刻を読み取れませんでした', '例 1:02.5 のように入力してください');
    if (target === 'A') setA(t);
    else setB(t);
  }

  function preview() {
    if (!range) return;
    onPreview(target === 'A' ? range.start : Math.max(range.start, range.end - 1.5));
  }
</script>

{#if range}
  <div class="editor" class:sec={kind === 'section'}>
    <p class="hint">
      テキストをタップすると <b>{target === 'A' ? (kind === 'ab' ? 'A' : '始まり') : kind === 'ab' ? 'B' : '終わり'}</b> を置けます（再生位置は動きません）
    </p>

    <div class="points">
      {#each ['A', 'B'] as p (p)}
        <button class="point" class:on={target === p} onclick={() => (target = p as 'A' | 'B')}>
          <span class="tag">{kind === 'ab' ? p : p === 'A' ? '始' : '終'}</span>
          <span class="t">{formatTimePrecise(p === 'A' ? range.start : range.end)}</span>
        </button>
      {/each}
    </div>

    <div class="row">
      <button class="step" aria-label={`1${unit}前へ`} onclick={() => stepWord(-1)}>◀{unit}</button>
      <button class="step" aria-label={`${fine}秒前へ`} onclick={() => nudge(-fine)}>−{fine}秒</button>
      <button class="step" aria-label={`${fine}秒後へ`} onclick={() => nudge(fine)}>+{fine}秒</button>
      <button class="step" aria-label={`1${unit}後へ`} onclick={() => stepWord(1)}>{unit}▶</button>
      <button class="step" aria-label="時刻を入力" onclick={typeTime}>時刻</button>
      <button class="step play" aria-label="この点を聞いて確かめる" onclick={preview}><Icon name="play" /></button>
    </div>

    <div class="opt">
      <span class="lbl">回数</span>
      {#each COUNTS as c}
        <button class="chip" class:on={range.repeatCount === c} onclick={() => loop.update(kind, { repeatCount: c, played: 0 })}>{c === 0 ? '∞' : c}</button>
      {/each}
    </div>
    <div class="opt">
      <span class="lbl">間隔</span>
      {#each GAPS as g}
        <button class="chip" class:on={range.gapSec === g} onclick={() => loop.update(kind, { gapSec: g })}>{g}秒</button>
      {/each}
    </div>

    <div class="actions">
      <button class="pill" onclick={onSave}><Icon name="bookmark" />{range.savedId ? '上書き保存' : '保存'}</button>
      <button class="pill" onclick={() => loop.release(kind)}><Icon name="close" />解除</button>
    </div>
  </div>
{/if}

<style>
  .editor {
    display: grid;
    gap: 8px;
    --c: #8ab8ff;
  }
  .editor.sec {
    --c: var(--accent);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .hint b {
    color: var(--c);
  }
  .points {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .point {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid transparent;
  }
  .point.on {
    border-color: var(--c);
  }
  .tag {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--c);
    color: #000;
  }
  .t {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .step {
    flex: 1;
    height: 34px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 13px;
    display: grid;
    place-items: center;
  }
  .step:active {
    background: var(--line);
  }
  .step.play {
    flex: 0 0 40px;
    color: var(--c);
  }
  .step.play :global(svg) {
    width: 16px;
    height: 16px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .lbl {
    font-size: 12px;
    color: var(--text-dim);
    width: 30px;
    flex: none;
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
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
