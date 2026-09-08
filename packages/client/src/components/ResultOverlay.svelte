<script lang="ts">
  interface Props {
    title: string;
    detail: string;
    onDismiss: () => void;
    onPlayAgain: () => void;
  }

  let { title, detail, onDismiss, onPlayAgain }: Props = $props();

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onDismiss();
  }
</script>

<div class="overlay" role="presentation" onclick={onBackdropClick}>
  <div class="panel result" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <h2 id="result-title">{title}</h2>
    <p>{detail}</p>
    <div class="buttons">
      <button class="btn-secondary" onclick={onDismiss}>View Board</button>
      <button onclick={onPlayAgain}>Play Again</button>
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
  }

  .result h2 { margin-top: 0; }

  .buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
</style>
