<script lang="ts">
  import { type LobbyId, settingsForLobby } from '@lose-at-chess/protocol';
  import { router } from '../router.svelte';
  import { LobbyQueue } from '../net/lobby.svelte';
  import { describeSettings } from './choices';

  // The parent re-keys this component on the lobby, so it is fixed for our lifetime.
  let { lobby }: { lobby: LobbyId } = $props();

  // svelte-ignore state_referenced_locally
  const queue = new LobbyQueue(lobby);
  const settings = settingsForLobby(queue.lobby);
  $effect(() => () => queue.cancel());

  $effect(() => {
    if (queue.matchedGameId) router.navigate(`/game/${queue.matchedGameId}`);
  });

  function cancel() {
    queue.cancel();
    router.navigate('/');
  }
</script>

<section class="panel waiting">
  <p><span class="spinner"></span> Looking for an opponent...</p>
  <p class="hint">{describeSettings(settings.setupMoves, settings.timed)}</p>
  {#if queue.errorMessage}
    <p class="error">{queue.errorMessage}</p>
  {:else if queue.connection === 'closed'}
    <p class="hint">Connection lost; reconnecting...</p>
  {/if}
  <button class="btn-secondary" onclick={cancel}>Cancel</button>
</section>

<style>
  .waiting {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
  }

  .waiting p {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
  }

  .hint {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .error { color: #f28b82; }
</style>
