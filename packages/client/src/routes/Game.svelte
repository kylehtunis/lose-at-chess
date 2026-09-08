<script lang="ts">
  import { OnlineGame } from '../game/online.svelte';
  import { colorName } from '../game/rules';
  import { router } from '../router.svelte';
  import GameArea from '../components/GameArea.svelte';

  // The parent re-keys this component on the id, so it is fixed for our lifetime.
  let { gameId }: { gameId: string } = $props();

  const debugMismatch = new URLSearchParams(location.search).has('debug-mismatch');
  // svelte-ignore state_referenced_locally
  const game = new OnlineGame(gameId, debugMismatch);
  $effect(() => () => game.disconnect());

  const connectionNote = $derived.by(() => {
    if (game.connection === 'connecting') return 'Connecting...';
    if (game.connection === 'closed') return 'Connection lost';
    if (game.phase !== 'waiting' && !game.opponentConnected) return 'Opponent disconnected';
    return null;
  });
</script>

{#if game.errorMessage}
  <p class="notice error">{game.errorMessage}</p>
{/if}

{#if game.phase === 'waiting'}
  <section class="panel waiting">
    <p>Waiting for an opponent to join.</p>
    <p class="hint">Share this page's URL with a friend to start.</p>
    {#if connectionNote}<p class="hint">{connectionNote}</p>{/if}
  </section>
{:else}
  <GameArea
    {game}
    canMove={game.isMyTurn}
    orientation={game.myColor ?? 'w'}
    onMove={(from, to) => game.tryMove(from, to)}
    onPlayAgain={() => router.navigate('/')}
  >
    {#snippet status()}
      {#if game.myColor}You are {colorName(game.myColor)}{/if}
      {#if connectionNote} · {connectionNote}{/if}
    {/snippet}
  </GameArea>
{/if}

<style>
  .waiting {
    text-align: center;
  }

  .waiting p { margin: 0.25rem 0; }

  .hint {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .notice {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    background: var(--panel);
  }

  .error { color: #f28b82; }
</style>
