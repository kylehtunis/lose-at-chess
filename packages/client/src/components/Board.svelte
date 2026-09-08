<script lang="ts">
  import { untrack } from 'svelte';
  import { Chessboard, INPUT_EVENT_TYPE, type MoveInputEvent } from 'cm-chessboard';
  import piecesUrl from 'cm-chessboard/assets/pieces/standard.svg?url';
  import type { Color } from '../game/rules';

  interface Props {
    fen: string;
    // Whether pieces can be moved at all. Only `turn`'s pieces may be picked up.
    interactive: boolean;
    turn: Color;
    animate?: boolean;
    onMove: (from: string, to: string) => boolean;
  }

  let { fen, interactive, turn, animate = true, onMove }: Props = $props();

  let container: HTMLDivElement;
  let board = $state.raw<Chessboard | null>(null);

  // Created once; the initial FEN is read untracked so later moves update the
  // existing board instead of rebuilding it.
  $effect(() => {
    const created = new Chessboard(container, {
      position: untrack(() => fen),
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

  function handleInput(event: MoveInputEvent): boolean {
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      // Piece names are color-prefixed, e.g. "wp".
      return event.piece?.charAt(0) === turn;
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
