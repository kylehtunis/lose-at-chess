<script lang="ts">
  import { type Eval, EVAL_CLAMP_PAWNS, evalToWhiteAdvantage, formatEval } from '../game/eval';

  let { value }: { value: Eval | null } = $props();

  const whitePct = $derived(50 + (evalToWhiteAdvantage(value) / EVAL_CLAMP_PAWNS) * 50);
  const labelOnWhite = $derived(whitePct >= 50);
</script>

<div class="eval-bar">
  <div class="fill" style:height="{whitePct}%"></div>
  <span class="label" class:on-white={labelOnWhite} class:on-black={!labelOnWhite}>
    {formatEval(value ?? { type: 'cp', value: 0 })}
  </span>
</div>

<style>
  .eval-bar {
    position: relative;
    width: 28px;
    height: 480px;
    background: #444;
    border-radius: 4px;
    overflow: hidden;
  }

  .fill {
    position: absolute;
    bottom: 0;
    width: 100%;
    background: #f0f0f0;
    transition: height 0.3s ease;
  }

  .label {
    position: absolute;
    width: 100%;
    text-align: center;
    font-size: 0.65rem;
    font-weight: 600;
    font-family: ui-monospace, Menlo, monospace;
    z-index: 1;
  }

  .label.on-white { bottom: 4px; color: #1a1a1a; }
  .label.on-black { top: 4px; color: #ececf1; }
</style>
