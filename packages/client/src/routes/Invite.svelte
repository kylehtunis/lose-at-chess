<script lang="ts">
  import Game from './Game.svelte';

  // An invite link is the game id; the only difference from /game/:id is how
  // a full or vanished game is explained.
  let { code }: { code: string } = $props();
</script>

<Game gameId={code} invite />
