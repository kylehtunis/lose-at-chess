<script lang="ts" generics="T extends string | number | boolean">
  interface Props {
    options: { value: T; label: string }[];
    value: T;
    label: string;
  }

  let { options, value = $bindable(), label }: Props = $props();
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      class:selected={value === option.value}
      onclick={() => (value = option.value)}
    >
      {option.label}
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
