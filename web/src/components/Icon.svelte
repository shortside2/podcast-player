<script lang="ts">
  // よく使うアイコン（SF Symbols 風の線画）
  let { name }: { name: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'play'}
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />
  {:else if name === 'pause'}
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  {:else if name === 'back5'}
    <path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 3v4h4" />
    <text x="12" y="15.5" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-family="-apple-system" font-weight="700">5</text>
  {:else if name === 'fwd5'}
    <path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 3v4h-4" />
    <text x="12" y="15.5" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-family="-apple-system" font-weight="700">5</text>
  {:else if name === 'prevSentence'}
    <path d="M6 5v14" /><path d="M18 5 9 12l9 7z" fill="currentColor" />
  {:else if name === 'nextSentence'}
    <path d="M18 5v14" /><path d="M6 5l9 7-9 7z" fill="currentColor" />
  {:else if name === 'chevron-left'}
    <path d="M15 5l-7 7 7 7" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'minus'}
    <path d="M5 12h14" />
  {:else if name === 'more'}
    <circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  {:else if name === 'locate'}
    <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  {:else if name === 'import'}
    <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" />
  {:else if name === 'bookmark'}
    <path d="M6 3h12v18l-6-4-6 4z" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'repeat'}
    <path d="M4 11V9a3 3 0 0 1 3-3h12" /><path d="M16 3l3 3-3 3" /><path d="M20 13v2a3 3 0 0 1-3 3H5" /><path d="M8 21l-3-3 3-3" />
  {:else if name === 'list'}
    <path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" />
  {:else if name === 'edit'}
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  {:else if name === 'send'}
    <path d="M4 12 20 4l-5 16-3-7z" /><path d="M12 13 20 4" />
  {:else if name === 'marker'}
    <path d="M4 20h16" /><path d="M7 16l9-9 3 3-9 9H7z" />
  {:else if name === 'check'}
    <path d="M5 12l5 5 9-10" />
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
  {:else if name === 'share'}
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" />
  {:else if name === 'eye'}
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
  {:else if name === 'eye-off'}
    <path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  {/if}
</svg>

<style>
  svg {
    width: 24px;
    height: 24px;
  }
</style>
