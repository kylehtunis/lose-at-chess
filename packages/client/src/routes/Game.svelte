<script lang="ts">
  import { OnlineGame } from '../game/online.svelte';
  import { colorName } from '../game/rules';
  import { inviteUrl } from '../net/invite';
  import { router } from '../router.svelte';
  import GameArea from '../components/GameArea.svelte';
  import { describeSettings } from './choices';

  interface Props {
    // The parent re-keys this component on the id, so it is fixed for our lifetime.
    gameId: string;
    // Reached through an invite link: errors are explained in those terms.
    invite?: boolean;
  }

  let { gameId, invite = false }: Props = $props();

  const debugMismatch = new URLSearchParams(location.search).has('debug-mismatch');
  // svelte-ignore state_referenced_locally
  const game = new OnlineGame(gameId, debugMismatch);
  $effect(() => () => game.disconnect());

  // Both players move to the new game once a rematch is accepted.
  $effect(() => {
    if (game.rematch === 'accepted' && game.rematchGameId) {
      const next = game.rematchGameId;
      game.leave();
      router.navigate(`/game/${next}`);
    }
  });

  let copied = $state(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl(gameId));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard unavailable; the link is visible to copy by hand.
    }
  }

  function leaveTo(path: string) {
    game.leave();
    router.navigate(path);
  }

  const fatalMessage = $derived.by(() => {
    switch (game.fatalError) {
      case 'no-such-game':
        return invite ? 'This invite has expired.' : 'This game no longer exists.';
      case 'game-full':
        return invite ? 'This invite has already been used.' : 'This game already has two players.';
      case 'version-mismatch':
        return 'This page is out of date. Reload to get the latest version.';
      default:
        return null;
    }
  });

  const connectionNote = $derived.by(() => {
    if (game.connection === 'connecting') return 'Connecting...';
    if (game.connection === 'closed') return 'Connection lost, reconnecting...';
    if (game.phase === 'waiting') return null;
    if (game.opponent === 'reconnecting') return 'Opponent reconnecting...';
    if (game.opponent === 'gone') return 'Opponent has left';
    return null;
  });

  // The creator of an invite is alone until someone opens the link. A lobby
  // match or rematch has an opponent seated who just has not connected yet.
  const showInviteLink = $derived(game.phase === 'waiting' && game.invite && game.opponent === 'gone');
</script>

{#if fatalMessage}
  <section class="panel waiting">
    <p>{fatalMessage}</p>
    <button onclick={() => router.navigate('/')}>Back to home</button>
  </section>
{:else if game.phase === 'waiting'}
  <section class="panel waiting">
    {#if showInviteLink}
      <p>Send this link to a friend. The game starts when they open it.</p>
      <div class="link-row">
        <input type="text" readonly value={inviteUrl(gameId)} onfocus={(e) => e.currentTarget.select()} />
        <button onclick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
      </div>
      <p class="hint">{describeSettings(game.settings.setupMoves, game.settings.timed)}</p>
    {:else}
      <p><span class="spinner"></span> Waiting for your opponent to connect...</p>
    {/if}
    {#if connectionNote}<p class="hint">{connectionNote}</p>{/if}
    {#if game.errorMessage}<p class="error">{game.errorMessage}</p>{/if}
    <button class="btn-secondary" onclick={() => leaveTo('/')}>Cancel</button>
  </section>
{:else}
  {#if game.errorMessage}
    <p class="notice error">{game.errorMessage}</p>
  {/if}
  <GameArea
    {game}
    canMove={game.isMyTurn}
    orientation={game.myColor ?? 'w'}
    onMove={(from, to) => game.tryMove(from, to)}
  >
    {#snippet status()}
      {#if game.myColor}You are {colorName(game.myColor)}{/if}
      {#if connectionNote} · {connectionNote}{/if}
    {/snippet}
    {#snippet resultActions()}
      {#if game.rematch === 'offered-by-opponent'}
        <p class="note">Your opponent wants a rematch.</p>
        <button onclick={() => game.acceptRematch()}>Accept</button>
        <button class="btn-secondary" onclick={() => game.declineRematch()}>Decline</button>
      {:else if game.rematch === 'offered-by-me'}
        <p class="note"><span class="spinner"></span> Rematch offered, waiting for your opponent...</p>
      {:else if game.rematch === 'accepted'}
        <p class="note">Rematch accepted, starting...</p>
      {:else if game.rematch === 'declined'}
        <p class="note">Your opponent declined a rematch.</p>
      {:else if game.rematch === 'withdrawn' || game.opponent === 'gone'}
        <p class="note">Your opponent has left.</p>
      {:else}
        <button onclick={() => game.offerRematch()}>Rematch</button>
      {/if}
      {#if game.invite}
        <button class="btn-secondary" onclick={() => leaveTo('/')}>Back to home</button>
      {:else}
        <button class="btn-secondary" onclick={() => leaveTo(`/queue/${game.lobby}`)}>Play again</button>
      {/if}
    {/snippet}
  </GameArea>
{/if}

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

  .link-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    max-width: 520px;
  }

  .link-row input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--divider);
    border-radius: 4px;
  }

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

  .note .spinner { margin-right: 0.4rem; }
</style>
