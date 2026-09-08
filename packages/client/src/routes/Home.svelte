<script lang="ts">
  import { router } from '../router.svelte';
</script>

<section class="panel home">
  <button onclick={() => router.navigate('/local')}>Play locally</button>
  <p class="hint">Two players, one screen. Online play is coming.</p>
</section>

<style>
  .home {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
