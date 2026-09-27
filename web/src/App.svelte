<script lang="ts">
  import { router } from './lib/router.svelte';
  import Library from './routes/Library.svelte';
  import Player from './routes/Player.svelte';
</script>

{#if router.route.name === 'player'}
  {#key router.route.id}
    <Player id={router.route.id} />
  {/key}
{:else}
  <Library />
{/if}
