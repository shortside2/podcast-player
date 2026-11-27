<script lang="ts">
  import { THEME_LABEL, theme, type ThemePref } from '../lib/theme.svelte';

  const OPTIONS: ThemePref[] = ['dark', 'light', 'auto'];
</script>

<div class="seg" role="radiogroup" aria-label="表示の明るさ">
  {#each OPTIONS as p (p)}
    <button role="radio" aria-checked={theme.pref === p} class:on={theme.pref === p} onclick={() => theme.set(p)}>{THEME_LABEL[p]}</button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    background: var(--surface-2);
    border-radius: 10px;
    padding: 2px;
  }
  .seg button {
    flex: 1;
    padding: 7px 8px;
    border-radius: 8px;
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 2px var(--shadow);
  }
</style>
