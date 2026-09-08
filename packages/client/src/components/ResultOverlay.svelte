<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    detail: string;
    onDismiss: () => void;
    // Buttons and status for what happens next; differs between local and online play.
    actions: Snippet;
  }

  let { title, detail, onDismiss, actions }: Props = $props();

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onDismiss();
  }
</script>

<div class="overlay" role="presentation" onclick={onBackdropClick}>
  <div class="panel result" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <h2 id="result-title">{title}</h2>
    <p>{detail}</p>
    <div class="actions">
      {@render actions()}
      <button class="btn-secondary" onclick={onDismiss}>View Board</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
  }

  .result {
    text-align: center;
    min-width: 300px;
    max-width: 420px;
  }

  .result h2 { margin-top: 0; }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
  }

  .actions :global(.note) {
    width: 100%;
    margin: 0 0 0.25rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
