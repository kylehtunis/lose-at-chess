<script lang="ts">
  import type { SetupMoves } from '@lose-at-chess/protocol';
  import { LocalGame } from '../game/state.svelte';
  import { colorName } from '../game/rules';
  import Board from '../components/Board.svelte';
  import EvalBar from '../components/EvalBar.svelte';
  import EvalTimeline from '../components/EvalTimeline.svelte';
  import MoveHistory from '../components/MoveHistory.svelte';
  import ResultOverlay from '../components/ResultOverlay.svelte';
  import SetupMovesPicker from '../components/SetupMovesPicker.svelte';

  const game = new LocalGame();
  let setupMoves = $state<SetupMoves>(10);

  const reviewing = $derived(game.phase === 'complete');

  const infoBar = $derived.by(() => {
    switch (game.phase) {
      case 'setup':
        return {
          phase: 'Setup phase',
          counter: `Remaining: White ${game.whiteRemaining} / Black ${game.blackRemaining}`,
          turn: `${colorName(game.turn)} to move`,
        };
      case 'engine':
        return {
          phase: 'Engine phase',
          counter: 'Engine is playing both sides',
          turn: `${colorName(game.turn)} thinking...`,
        };
      default:
        return { phase: 'Game over', counter: '', turn: '' };
    }
  });

  function onKeydown(event: KeyboardEvent) {
    if (!reviewing || game.viewPly === null) return;
    const jumps: Record<string, number> = {
      ArrowLeft: game.viewPly - 1,
      ArrowRight: game.viewPly + 1,
      Home: 0,
      End: game.allFens.length - 1,
    };
    const target = jumps[event.key];
    if (target === undefined) return;
    event.preventDefault();
    game.navigateTo(target);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if game.phase === 'config'}
  <section class="panel config">
    <SetupMovesPicker bind:value={setupMoves} />
    <button onclick={() => game.start(setupMoves)}>Start Game</button>
  </section>
{:else}
  <section>
    <div class="info-bar">
      <span class="phase">{infoBar.phase}</span>
      <span>{infoBar.counter}</span>
      <span>{infoBar.turn}</span>
    </div>
    <div class="board-row">
      {#if game.showEvalBar}
        <EvalBar value={game.currentEval} />
      {/if}
      <Board
        fen={game.displayFen}
        interactive={game.phase === 'setup'}
        turn={game.turn}
        animate={!reviewing}
        onMove={(from, to) => game.tryMove(from, to)}
      />
      <MoveHistory
        history={game.history}
        enginePhaseStartPly={game.enginePhaseStartPly}
        reviewable={reviewing}
        viewPly={game.viewPly}
        onSelect={(ply) => game.navigateTo(ply)}
      />
    </div>
    {#if reviewing}
      <EvalTimeline
        evals={game.timelineEvals}
        progress={game.timelineProgress}
        markerPly={game.viewPly}
        enginePhaseStartPly={game.enginePhaseStartPly}
      />
    {/if}
  </section>
{/if}

{#if game.resultVisible && game.result}
  <ResultOverlay
    title={game.result.title}
    detail={game.result.detail}
    onDismiss={() => game.dismissResult()}
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

  .info-bar {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--panel);
    border-radius: 6px;
  }

  .phase {
    font-weight: 600;
    color: var(--accent);
  }

  .board-row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  @media (max-width: 720px) {
    .board-row { flex-direction: column; }
  }
</style>
