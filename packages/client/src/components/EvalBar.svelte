<script lang="ts">
  import type { Color } from '@lose-at-chess/protocol';
  import { type Eval, EVAL_CLAMP_PAWNS, evalToWhiteAdvantage, formatEval } from '../game/eval';

  interface Props {
    value: Eval | null;
    // Which side sits at the bottom, matching the board's orientation.
    orientation?: Color;
  }

  let { value, orientation = 'w' }: Props = $props();

  const flipped = $derived(orientation === 'b');
  const whitePct = $derived(50 + (evalToWhiteAdvantage(value) / EVAL_CLAMP_PAWNS) * 50);
  const labelOnWhite = $derived(whitePct >= 50);
  // The label sits at whichever end holds the leading side's color.
  const labelAtBottom = $derived(flipped ? !labelOnWhite : labelOnWhite);
</script>

<div class="eval-bar">
  <div class="fill" class:flipped style:height="{whitePct}%"></div>
  <span
    class="label"
    class:at-bottom={labelAtBottom}
    class:on-white={labelOnWhite}
  >
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

  .fill.flipped {
    bottom: auto;
    top: 0;
  }

  .label {
    position: absolute;
    top: 4px;
    width: 100%;
    text-align: center;
    font-size: 0.65rem;
    font-weight: 600;
    font-family: ui-monospace, Menlo, monospace;
    color: #ececf1;
    z-index: 1;
  }

  .label.at-bottom {
    top: auto;
    bottom: 4px;
  }

  .label.on-white { color: #1a1a1a; }
</style>
