<script lang="ts">
  // 星 0〜5 の評価。同じ星をもう一度押すと 0 に戻る。onChange がなければ表示だけ
  let { value, onChange }: { value: number; onChange?: (v: number) => void } = $props();
</script>

<span class="stars" class:readonly={!onChange} aria-label={`評価 ${value}`}>
  {#each [1, 2, 3, 4, 5] as n}
    {#if onChange}
      <button aria-label={`星${n}`} class:on={n <= value} onclick={() => onChange(n === value ? 0 : n)}>★</button>
    {:else}
      <span class:on={n <= value}>★</span>
    {/if}
  {/each}
</span>

<style>
  .stars {
    display: inline-flex;
    gap: 1px;
  }
  button,
  span > span {
    color: var(--line);
    font-size: 18px;
    line-height: 1;
    padding: 2px;
  }
  .readonly span {
    font-size: 11px;
    padding: 0;
  }
  .on {
    color: #ffc93c !important;
  }
</style>
