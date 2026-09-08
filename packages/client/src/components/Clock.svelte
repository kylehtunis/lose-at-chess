<script lang="ts">
  import type { Color } from '@lose-at-chess/protocol';
  import { colorName } from '../game/rules';

  interface Props {
    color: Color;
    // Absolute time (ms since epoch) at which the server will move for `color`.
    deadline: number;
  }

  let { color, deadline }: Props = $props();

  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(timer);
  });

  const remainingMs = $derived(Math.max(0, deadline - now));
  const seconds = $derived(Math.ceil(remainingMs / 1000));
  const urgent = $derived(remainingMs < 10_000);
</script>

<span class="clock" class:urgent aria-live="polite">
  {colorName(color)}: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
</span>

<style>
  .clock {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .urgent { color: #f28b82; }
</style>
