<script lang="ts">
  import { untrack } from 'svelte';
  import { Chessboard, INPUT_EVENT_TYPE, type MoveInputEvent } from 'cm-chessboard';
  import piecesUrl from 'cm-chessboard/assets/pieces/standard.svg?url';
  import type { Color } from '@lose-at-chess/protocol';

  interface Props {
    fen: string;
    // Whether move input is armed at all. Keep this stable for a whole phase:
    // toggling it per turn re-arms cm-chessboard mid-animation and drops moves.
    interactive: boolean;
    // Only `turn`'s pieces may be picked up, and only when `canMove` holds
    // (online, that means it is this player's side to move).
    turn: Color;
    canMove?: boolean;
    // Which side sits at the bottom of the board.
    orientation?: Color;
    animate?: boolean;
    onMove: (from: string, to: string) => boolean;
  }

  let { fen, interactive, turn, canMove = true, orientation = 'w', animate = true, onMove }: Props = $props();

  let container: HTMLDivElement;
  let board = $state.raw<Chessboard | null>(null);

  // Created once; the initial FEN and orientation are read untracked so later
  // changes update the existing board instead of rebuilding it.
  $effect(() => {
    const created = new Chessboard(container, {
      position: untrack(() => fen),
      orientation: untrack(() => orientation),
      assetsUrl: '/',
      style: { pieces: { file: piecesUrl }, showCoordinates: true },
    });
    board = created;
    return () => {
      created.destroy();
      board = null;
    };
  });

  $effect(() => {
    void board?.setPosition(fen, animate);
  });

  $effect(() => {
    void board?.setOrientation(orientation, false);
  });

  function handleInput(event: MoveInputEvent): boolean {
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      // Piece names are color-prefixed, e.g. "wp".
      return canMove && event.piece?.charAt(0) === turn;
    }
    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      return onMove(event.squareFrom, event.squareTo ?? '');
    }
    return true;
  }

  // Input stays enabled for the whole setup phase. Gating by side to move
  // happens in the handler, so the board is not re-armed mid-animation on
  // every turn change.
  $effect(() => {
    if (!board || !interactive) return;
    board.enableMoveInput(handleInput);
    return () => board?.disableMoveInput();
  });
</script>

<div class="board" bind:this={container}></div>

<style>
  .board {
    width: 480px;
    max-width: 100%;
  }
</style>
