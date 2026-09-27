<script lang="ts">
  import { dialog } from '../lib/dialog.svelte';

  let value = $state('');
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    const c = dialog.current;
    if (c?.input !== undefined) {
      value = c.input;
      queueMicrotask(() => inputEl?.select());
    }
  });

  function ok() {
    const c = dialog.current;
    if (!c) return;
    dialog.close(c.input !== undefined ? value : '');
  }
</script>

{#if dialog.current}
  {@const c = dialog.current}
  <div class="backdrop" role="presentation" onclick={() => dialog.close(null)}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={c.title} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && dialog.close(null)}>
      <h2>{c.title}</h2>
      {#if c.message}<p>{c.message}</p>{/if}
      {#if c.input !== undefined}
        <input bind:this={inputEl} bind:value onkeydown={(e) => e.key === 'Enter' && ok()} />
      {/if}
      <div class="buttons">
        {#if c.cancelLabel}<button onclick={() => dialog.close(null)}>{c.cancelLabel}</button>{/if}
        <button class="ok" class:danger={c.danger} onclick={ok}>{c.okLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 100;
    padding: 24px;
  }
  .dialog {
    width: min(340px, 100%);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 18px 18px 12px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 16px;
  }
  p {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-dim);
    white-space: pre-wrap;
  }
  input {
    width: 100%;
    margin: 4px 0 10px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .buttons button {
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 15px;
    color: var(--text-dim);
  }
  .buttons .ok {
    color: var(--accent);
    font-weight: 600;
  }
  .buttons .ok.danger {
    color: var(--danger);
  }
</style>
