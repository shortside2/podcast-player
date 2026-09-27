<script lang="ts">
  import Dialog from './components/Dialog.svelte';
  import { router } from './lib/router.svelte';
  import Library from './routes/Library.svelte';
  import Marks from './routes/Marks.svelte';
  import Player from './routes/Player.svelte';
</script>

{#if router.route.name === 'player'}
  {#key `${router.route.id}|${router.route.t}|${router.route.play?.join(',')}`}
    <Player id={router.route.id} startAt={router.route.t} playIds={router.route.play} />
  {/key}
{:else if router.route.name === 'marks'}
  {#key router.route.episodeId}
    <Marks episodeId={router.route.episodeId} />
  {/key}
{:else}
  <Library />
{/if}

<Dialog />
