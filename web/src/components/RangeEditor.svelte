<script lang="ts">
  import Icon from './Icon.svelte';
  import { formatTimePrecise, parseTime } from '../lib/format';
  import type { LoopController, RangeKind } from '../lib/playback/loop.svelte';
  import type { Transcript } from '../lib/transcript/transcript';

  let {
    loop,
    kind,
    transcript,
    currentTime,
    onPreview,
    onSave,
  }: {
    loop: LoopController;
    kind: RangeKind;
    transcript: Transcript;
    /** 現在の再生位置（スクリプトの時刻） */
    currentTime: () => number;
    /** 調整した点を聞いて確かめるために、その付近から再生する */
    onPreview: (t: number) => void;
    onSave: () => void;
  } = $props();

  const COUNTS = [1, 2, 3, 5, 10, 0];
  const GAPS = [0, 0.5, 1, 1.5, 2, 3];
  const MIN_LEN = 0.3;

  const range = $derived(kind === 'ab' ? loop.ab : loop.section);
  // 区間は大きな範囲なので、単語ではなく文単位・1 秒単位で動かす
  const fine = $derived(kind === 'ab' ? 0.1 : 1);
  const unit = $derived(kind === 'ab' ? '語' : '文');

  function setA(a: number) {
    if (!range) return;
    const start = Math.max(0, Math.min(a, range.end - MIN_LEN));
    loop.update(kind, { start });
    onPreview(start);
  }

  function setB(b: number) {
    if (!range) return;
    const end = Math.min(transcript.duration, Math.max(b, range.start + MIN_LEN));
    loop.update(kind, { end });
    // B 点の直前から再生して、終わり方を確かめられるようにする
    onPreview(Math.max(range.start, end - 1.5));
  }

  function stepA(dir: -1 | 1) {
    if (!range) return;
    if (kind === 'ab') {
      const i = transcript.wordForAPoint(range.start) + dir;
      if (i >= 0 && i < transcript.words.length) setA(transcript.aPointForWord(i));
    } else {
      const si = transcript.sentenceOfWord(transcript.wordForAPoint(range.start)) + dir;
      const s = transcript.sentences[si];
      if (s) setA(transcript.aPointForWord(s.firstWord));
    }
  }

  function stepB(dir: -1 | 1) {
    if (!range) return;
    if (kind === 'ab') {
      const j = transcript.wordForBPoint(range.end) + dir;
      if (j >= 0 && j < transcript.words.length) setB(transcript.bPointForWord(j));
    } else {
      const si = transcript.sentenceOfWord(transcript.wordForBPoint(range.end)) + dir;
      const s = transcript.sentences[si];
      if (s) setB(transcript.bPointForWord(s.lastWord));
    }
  }

  function typeTime(which: 'A' | 'B') {
    if (!range) return;
    const cur = which === 'A' ? range.start : range.end;
    const text = prompt(`${which} 点の時刻（例 1:02.5）`, formatTimePrecise(cur));
    if (text == null) return;
    const t = parseTime(text);
    if (t == null) return alert('時刻を読み取れませんでした（例 1:02.5）');
    if (which === 'A') setA(t);
    else setB(t);
  }

  function wordAtA(): string {
    if (!range) return '';
    const i = transcript.wordForAPoint(range.start);
    return transcript.words.slice(i, i + 4).map((w) => w.text).join(' ') + ' …';
  }

  function wordAtB(): string {
    if (!range) return '';
    const j = transcript.wordForBPoint(range.end);
    return '… ' + transcript.words.slice(Math.max(0, j - 3), j + 1).map((w) => w.text).join(' ');
  }
</script>

{#if range}
  <div class="editor">
    {#each ['A', 'B'] as which (which)}
      {@const isA = which === 'A'}
      <div class="point">
        <span class="tag" class:ab={kind === 'ab'}>{which}</span>
        <div class="row">
          <button class="step" aria-label={`${which}点を1${unit}前へ`} onclick={() => (isA ? stepA(-1) : stepB(-1))}>◀{unit}</button>
          <button class="step" aria-label={`${which}点を${fine}秒前へ`} onclick={() => (isA ? setA(range.start - fine) : setB(range.end - fine))}>−{fine}</button>
          <button class="time" onclick={() => typeTime(which as 'A' | 'B')}>{formatTimePrecise(isA ? range.start : range.end)}</button>
          <button class="step" aria-label={`${which}点を${fine}秒後へ`} onclick={() => (isA ? setA(range.start + fine) : setB(range.end + fine))}>+{fine}</button>
          <button class="step" aria-label={`${which}点を1${unit}後へ`} onclick={() => (isA ? stepA(1) : stepB(1))}>{unit}▶</button>
        </div>
        <div class="sub">
          <span class="preview">{isA ? wordAtA() : wordAtB()}</span>
          <button class="now" onclick={() => (isA ? setA(currentTime()) : setB(currentTime()))}>今の位置に</button>
        </div>
      </div>
    {/each}

    <div class="opt">
      <span class="lbl">回数</span>
      <div class="chips">
        {#each COUNTS as c}
          <button class="chip" class:on={range.repeatCount === c} onclick={() => loop.update(kind, { repeatCount: c, played: 0 })}>{c === 0 ? '∞' : c}</button>
        {/each}
      </div>
    </div>
    <div class="opt">
      <span class="lbl">間隔</span>
      <div class="chips">
        {#each GAPS as g}
          <button class="chip" class:on={range.gapSec === g} onclick={() => loop.update(kind, { gapSec: g })}>{g}秒</button>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button class="pill" onclick={onSave}><Icon name="bookmark" />{range.savedId ? '上書き保存' : '名前を付けて保存'}</button>
      <button class="pill" onclick={() => loop.release(kind)}><Icon name="close" />解除</button>
    </div>
  </div>
{/if}

<style>
  .editor {
    display: grid;
    gap: 8px;
  }
  .point {
    display: grid;
    grid-template-columns: 24px 1fr;
    column-gap: 8px;
    align-items: center;
  }
  .tag {
    grid-row: span 2;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
    background: var(--surface-2);
    color: var(--accent);
  }
  .tag.ab {
    color: #8ab8ff;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .step {
    height: 32px;
    min-width: 36px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .step:active {
    background: var(--line);
  }
  .sub {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .now {
    flex: none;
    font-size: 12px;
    color: var(--accent);
    padding: 4px 0;
  }
  .time {
    min-width: 64px;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .preview {
    flex: 1;
    min-width: 0;
    font-family: var(--reading);
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    font-size: 12px;
    color: var(--text-dim);
    width: 28px;
    flex: none;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    height: 28px;
    min-width: 36px;
    padding: 0 8px;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 13px;
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
