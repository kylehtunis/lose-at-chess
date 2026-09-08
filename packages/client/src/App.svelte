<script lang="ts">
  import { isLobbyId } from '@lose-at-chess/protocol';
  import { router } from './router.svelte';
  import Home from './routes/Home.svelte';
  import Local from './routes/Local.svelte';
  import Game from './routes/Game.svelte';
  import Invite from './routes/Invite.svelte';
  import Queue from './routes/Queue.svelte';

  const gameId = $derived(router.pathname.match(/^\/game\/([a-z0-9]+)$/)?.[1] ?? null);
  const inviteCode = $derived(router.pathname.match(/^\/invite\/([a-z0-9]+)$/)?.[1] ?? null);
  const lobby = $derived.by(() => {
    const id = router.pathname.match(/^\/queue\/([a-z0-9-]+)$/)?.[1];
    return isLobbyId(id) ? id : null;
  });

  function goHome(event: MouseEvent) {
    event.preventDefault();
    router.navigate('/');
  }
</script>

<header>
  <h1><a href="/" onclick={goHome}>Lose at Chess</a></h1>
  <p class="tagline">
    Play a normal game for a set number of moves, making the worst moves you can.
    Then the engine takes over both sides. Whoever's side loses, wins.
  </p>
</header>

<main>
  {#if gameId}
    {#key gameId}
      <Game {gameId} />
    {/key}
  {:else if inviteCode}
    {#key inviteCode}
      <Invite code={inviteCode} />
    {/key}
  {:else if lobby}
    {#key lobby}
      <Queue {lobby} />
    {/key}
  {:else if router.pathname === '/local'}
    <Local />
  {:else}
    <Home />
  {/if}
</main>
