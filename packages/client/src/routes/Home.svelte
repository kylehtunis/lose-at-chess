<script lang="ts">
  import { onDestroy } from 'svelte';
  import { LOBBY_IDS, type SetupMoves, settingsForLobby } from '@lose-at-chess/protocol';
  import { router } from '../router.svelte';
  import { LobbyDirectoryFeed } from '../net/directory.svelte';
  import { createInvite } from '../net/invite';
  import SegmentedPicker from '../components/SegmentedPicker.svelte';
  import { SETUP_MOVE_CHOICES, TIMER_CHOICES, describeSettings } from './choices';

  const directory = new LobbyDirectoryFeed();
  onDestroy(() => directory.close());

  let setupMoves = $state<SetupMoves>(10);
  let timed = $state(false);
  let creating = $state(false);
  let error = $state<string | null>(null);

  async function startInvite() {
    creating = true;
    error = null;
    try {
      const gameId = await createInvite({ setupMoves, timed });
      router.navigate(`/game/${gameId}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create the invite';
    } finally {
      creating = false;
    }
  }

  function plural(count: number, noun: string) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }
</script>

<div class="home">
  <section class="panel">
    <h2>Find an opponent</h2>
    <p class="hint">Pick a lobby. You are matched with the next player who picks the same one.</p>
    <div class="lobbies">
      {#each LOBBY_IDS as lobby (lobby)}
        {@const settings = settingsForLobby(lobby)}
        {@const counts = directory.counts[lobby]}
        <button class="lobby" onclick={() => router.navigate(`/queue/${lobby}`)}>
          <span class="lobby-name">{describeSettings(settings.setupMoves, settings.timed)}</span>
          <span class="lobby-counts">
            {plural(counts.waiting, 'player')} waiting · {plural(counts.inProgress, 'game')} in progress
          </span>
        </button>
      {/each}
    </div>
    {#if directory.connection === 'closed'}
      <p class="hint">Live counts unavailable; reconnecting...</p>
    {/if}
  </section>

  <section class="panel">
    <h2>Play a friend</h2>
    <div class="row">
      <SegmentedPicker options={SETUP_MOVE_CHOICES} bind:value={setupMoves} label="Setup moves per side" />
      <SegmentedPicker options={TIMER_CHOICES} bind:value={timed} label="Move timer" />
      <button onclick={startInvite} disabled={creating}>Create invite</button>
    </div>
    <p class="hint">You get a link to send. The first person to open it becomes your opponent.</p>
    {#if error}<p class="error">{error}</p>{/if}
  </section>

  <section class="panel">
    <h2>Same screen</h2>
    <div class="row">
      <button class="btn-secondary" onclick={() => router.navigate('/local')}>Play locally</button>
      <p class="hint">Two players, one device, no timer.</p>
    </div>
  </section>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .lobbies {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    margin: 0.75rem 0;
  }

  .lobby {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.75rem 1rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--divider);
    text-align: left;
  }

  .lobby:hover {
    border-color: var(--accent);
    filter: none;
  }

  .lobby-name { font-weight: 600; }

  .lobby-counts {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .hint, .error {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .hint { color: var(--muted); }
  .error { color: #f28b82; }
</style>
