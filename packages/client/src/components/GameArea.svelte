<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Color } from '@lose-at-chess/protocol';
  import type { GameCore } from '../game/state.svelte';
  import { colorName } from '../game/rules';
  import Board from './Board.svelte';
  import Clock from './Clock.svelte';
  import EvalBar from './EvalBar.svelte';
  import EvalTimeline from './EvalTimeline.svelte';
  import MoveHistory from './MoveHistory.svelte';
  import ResultOverlay from './ResultOverlay.svelte';

  interface Props {
    game: GameCore;
    // Whether this screen may move the side to move right now.
    canMove: boolean;
    // Which side sits at the bottom of the board. Online, this is the
    // viewer's own color so they always look at the board from their side.
    orientation?: Color;
    onMove: (from: string, to: string) => boolean;
    // Buttons shown on the result overlay: play again, rematch, and so on.
    resultActions: Snippet;
    // Extra text for the info bar, e.g. which side you are online.
    status?: Snippet;
  }

  let { game, canMove, orientation = 'w', onMove, resultActions, status }: Props = $props();

  const reviewing = $derived(game.phase === 'complete');

  const infoBar = $derived.by(() => {
    switch (game.phase) {
      case 'waiting':
        return { phase: 'Waiting for opponent', counter: '', turn: '' };
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
          turn: game.engineDone ? 'Waiting for the opponent to finish...' : `${colorName(game.turn)} thinking...`,
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

<section>
  <div class="info-bar">
    <span class="phase">{infoBar.phase}</span>
    <span>{infoBar.counter}</span>
    <span>{infoBar.turn}</span>
    {#if game.clockDeadline}
      <Clock color={game.clockDeadline.color} deadline={game.clockDeadline.deadline} />
    {/if}
    {#if status}
      <span class="status">{@render status()}</span>
    {/if}
  </div>
  <div class="board-row">
    {#if game.showEvalBar}
      <EvalBar value={game.currentEval} {orientation} />
    {/if}
    <Board
      fen={game.displayFen}
      interactive={game.phase === 'setup'}
      {canMove}
      turn={game.turn}
      {orientation}
      animate={!reviewing}
      {onMove}
    />
    <MoveHistory
      history={game.history}
      enginePhaseStartPly={game.enginePhaseStartPly}
      timeoutPlies={game.timeoutPlies}
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

{#if game.resultVisible && game.resultText}
  <ResultOverlay
    title={game.resultText.title}
    detail={game.resultText.detail}
    onDismiss={() => game.dismissResult()}
    actions={resultActions}
  />
{/if}

<style>
  .info-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--panel);
    border-radius: 6px;
  }

  .phase {
    font-weight: 600;
    color: var(--accent);
  }

  .status { color: var(--muted); }

  .board-row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  @media (max-width: 720px) {
    .board-row { flex-direction: column; }
  }
</style>
