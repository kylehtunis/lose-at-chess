<script lang="ts">
  import type { SetupMoves } from '@lose-at-chess/protocol';
  import { LocalGame } from '../game/state.svelte';
  import GameArea from '../components/GameArea.svelte';
  import SegmentedPicker from '../components/SegmentedPicker.svelte';
  import { SETUP_MOVE_CHOICES } from './choices';

  const game = new LocalGame();
  let setupMoves = $state<SetupMoves>(10);
</script>

{#if game.phase === 'config'}
  <section class="panel config">
    <SegmentedPicker options={SETUP_MOVE_CHOICES} bind:value={setupMoves} label="Setup moves per side" />
    <button onclick={() => game.start({ setupMoves, timed: false })}>Start Game</button>
  </section>
{:else}
  <GameArea {game} canMove={true} onMove={(from, to) => game.tryMove(from, to)}>
    {#snippet resultActions()}
      <button onclick={() => game.reset()}>Play Again</button>
    {/snippet}
  </GameArea>
{/if}

<style>
  .config {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: center;
  }
</style>
