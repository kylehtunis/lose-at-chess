<script lang="ts">
  interface Props {
    history: string[];
    enginePhaseStartPly: number | null;
    // Plies the server played automatically because a clock ran out.
    timeoutPlies?: number[];
    // When true, moves are clickable and the viewed ply is highlighted.
    reviewable: boolean;
    viewPly: number | null;
    onSelect: (ply: number) => void;
  }

  let { history, enginePhaseStartPly, timeoutPlies = [], reviewable, viewPly, onSelect }: Props = $props();

  const TIMEOUT_TITLE = 'Played automatically: the clock ran out';

  let panel: HTMLElement;

  // Pair plies into move rows: [moveNumber, whiteSan, blackSan?].
  const rows = $derived.by(() => {
    const out: { number: number; white: { san: string; ply: number }; black: { san: string; ply: number } | null }[] = [];
    for (let i = 0; i < history.length; i += 2) {
      out.push({
        number: i / 2 + 1,
        white: { san: history[i]!, ply: i + 1 },
        black: history[i + 1] !== undefined ? { san: history[i + 1]!, ply: i + 2 } : null,
      });
    }
    return out;
  });

  // Follow new moves as they arrive.
  $effect(() => {
    void history.length;
    panel.scrollTop = panel.scrollHeight;
  });

  // Keep the reviewed move in view.
  $effect(() => {
    if (viewPly === null) return;
    panel.querySelector(`[data-ply="${viewPly}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

{#snippet move(entry: { san: string; ply: number })}
  {@const timedOut = timeoutPlies.includes(entry.ply)}
  {#if reviewable}
    <button
      type="button"
      class="san clickable"
      class:active={entry.ply === viewPly}
      class:timeout={timedOut}
      data-ply={entry.ply}
      title={timedOut ? TIMEOUT_TITLE : undefined}
      onclick={() => onSelect(entry.ply)}
    >{entry.san}{#if timedOut}<span class="timeout-mark" aria-label="timeout">⏱</span>{/if}</button>
  {:else}
    <span class="san" class:timeout={timedOut} data-ply={entry.ply} title={timedOut ? TIMEOUT_TITLE : undefined}
    >{entry.san}{#if timedOut}<span class="timeout-mark" aria-label="timeout">⏱</span>{/if}</span>
  {/if}
{/snippet}

<aside class="history" bind:this={panel}>
  <h2>Moves</h2>
  <ol>
    {#each rows as row (row.number)}
      {#if enginePhaseStartPly !== null && row.white.ply - 1 === enginePhaseStartPly}
        <li class="divider">Engine takes over</li>
      {/if}
      <li value={row.number}>
        {@render move(row.white)}
        {#if row.black}
          {#if enginePhaseStartPly !== null && row.black.ply - 1 === enginePhaseStartPly}
            <span class="divider inline">Engine takes over</span>
          {/if}
          {@render move(row.black)}
        {/if}
      </li>
    {/each}
  </ol>
</aside>

<style>
  .history {
    flex: 1;
    min-width: 180px;
    max-height: 480px;
    overflow-y: auto;
    background: var(--panel);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: var(--muted);
  }

  ol {
    margin: 0;
    padding-left: 2rem;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.9rem;
  }

  li { padding: 0.1rem 0; }

  .san {
    display: inline-block;
    margin-right: 0.5rem;
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0.05rem 0.2rem;
    border-radius: 3px;
  }

  .san.clickable { cursor: pointer; }
  .san.clickable:hover { background: rgba(255, 255, 255, 0.1); }

  .san.timeout { color: #f28b82; }

  /* After .timeout so the highlight keeps readable text on a timed-out move. */
  .san.active {
    background: var(--accent);
    color: #1a1a1a;
  }

  .timeout-mark {
    margin-left: 0.15rem;
    font-size: 0.75em;
  }

  li.divider {
    list-style: none;
    margin: 0.5rem 0 0.5rem -2rem;
    padding: 0.25rem 0;
    border-top: 1px solid var(--divider);
    border-bottom: 1px solid var(--divider);
    text-align: center;
  }

  .divider {
    color: var(--accent);
    font-family: system-ui, sans-serif;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .divider.inline {
    display: inline-block;
    margin-right: 0.5rem;
  }

  @media (max-width: 720px) {
    .history { width: 100%; max-height: 200px; }
  }
</style>
