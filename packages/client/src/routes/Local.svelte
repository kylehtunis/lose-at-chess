<script lang="ts">
  import type { SetupMoves } from '@lose-at-chess/protocol';
  import { LocalGame } from '../game/state.svelte';
  import GameArea from '../components/GameArea.svelte';
  import SetupMovesPicker from '../components/SetupMovesPicker.svelte';

  const game = new LocalGame();
  let setupMoves = $state<SetupMoves>(10);
</script>

{#if game.phase === 'config'}
  <section class="panel config">
    <SetupMovesPicker bind:value={setupMoves} />
    <button onclick={() => game.start({ setupMoves, timed: false })}>Start Game</button>
  </section>
{:else}
  <GameArea
    {game}
    canMove={true}
    onMove={(from, to) => game.tryMove(from, to)}
    onPlayAgain={() => game.reset()}
  />
{/if}

<style>
  .config {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: center;
  }
</style>
