<script lang="ts">
  import type { SetupMoves } from '@lose-at-chess/protocol';
  import { router } from '../router.svelte';
  import SetupMovesPicker from '../components/SetupMovesPicker.svelte';

  let setupMoves = $state<SetupMoves>(10);
  let creating = $state(false);
  let error = $state<string | null>(null);

  // Temporary until lobbies and invites exist.
  async function createDebugGame() {
    creating = true;
    error = null;
    try {
      const response = await fetch('/api/debug/new-game', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupMoves, timed: false }),
      });
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      const { gameId } = (await response.json()) as { gameId: string };
      router.navigate(`/game/${gameId}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create game';
    } finally {
      creating = false;
    }
  }
</script>

<section class="panel home">
  <div class="row">
    <SetupMovesPicker bind:value={setupMoves} />
  </div>
  <div class="row">
    <button onclick={() => router.navigate('/local')}>Play locally</button>
    <button class="btn-secondary" onclick={createDebugGame} disabled={creating}>
      New online game (debug)
    </button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  <p class="hint">Online play is under construction. The online button creates a game you can share by URL.</p>
</section>

<style>
  .home {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .row {
    display: flex;
    gap: 0.75rem;
  }

  .hint, .error {
    margin: 0;
    font-size: 0.9rem;
  }

  .hint { color: var(--muted); }
  .error { color: #f28b82; }
</style>
