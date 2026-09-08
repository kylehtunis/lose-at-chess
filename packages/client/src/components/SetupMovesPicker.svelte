<script lang="ts">
  import { SETUP_MOVE_OPTIONS, type SetupMoves } from '@lose-at-chess/protocol';

  let { value = $bindable() }: { value: SetupMoves } = $props();
</script>

<div class="picker" role="radiogroup" aria-label="Setup moves per side">
  {#each SETUP_MOVE_OPTIONS as option (option)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option}
      class:selected={value === option}
      onclick={() => (value = option)}
    >
      {option} moves
    </button>
  {/each}
</div>

<style>
  .picker {
    display: inline-flex;
    border: 1px solid var(--divider);
    border-radius: 4px;
    overflow: hidden;
  }

  button {
    border-radius: 0;
    background: transparent;
    color: var(--text);
  }

  button:hover { background: rgba(255, 255, 255, 0.05); filter: none; }

  button.selected {
    background: var(--accent);
    color: #1a1a1a;
  }
</style>
