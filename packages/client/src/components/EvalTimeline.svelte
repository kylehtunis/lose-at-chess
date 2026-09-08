<script lang="ts">
  import { type Eval, EVAL_CLAMP_PAWNS, evalToWhiteAdvantage } from '../game/eval';

  interface Props {
    // One eval per ply, or null while analysis is still running.
    evals: (Eval | null)[] | null;
    progress: string;
    markerPly: number | null;
    enginePhaseStartPly: number | null;
  }

  let { evals, progress, markerPly, enginePhaseStartPly }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  const COLORS = {
    background: '#2a2a33',
    midline: '#55556a',
    accent: '#e0a458',
    marker: '#ececf1',
    markerOutline: '#1e1e24',
    axis: '#9a9aa8',
  };

  function render(
    target: HTMLCanvasElement,
    data: (Eval | null)[],
    marker: number | null,
    engineStart: number | null,
  ) {
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = target.clientWidth;
    const cssH = target.clientHeight;
    target.width = cssW * dpr;
    target.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 16, bottom: 28, left: 40 };
    const w = cssW - padding.left - padding.right;
    const h = cssH - padding.top - padding.bottom;
    const midY = padding.top + h / 2;
    const xAt = (i: number) => padding.left + (i / (data.length - 1)) * w;
    const yAt = (ev: Eval | null) => midY - (evalToWhiteAdvantage(ev) / EVAL_CLAMP_PAWNS) * (h / 2);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = COLORS.midline;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, midY);
    ctx.lineTo(padding.left + w, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (engineStart !== null && engineStart > 0 && data.length > 1) {
      const dividerX = xAt(engineStart - 0.5);
      ctx.strokeStyle = 'rgba(224, 164, 88, 0.4)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(dividerX, padding.top);
      ctx.lineTo(dividerX, padding.top + h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.accent;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('engine', dividerX, padding.top - 6);
    }

    if (data.length < 2) return;

    const tracePath = () => {
      ctx.beginPath();
      data.forEach((ev, i) => {
        if (i === 0) ctx.moveTo(xAt(i), yAt(ev));
        else ctx.lineTo(xAt(i), yAt(ev));
      });
    };

    // Shaded area between the curve and the midline, lighter on White's side.
    const fillArea = (gradient: CanvasGradient) => {
      tracePath();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = gradient;
      ctx.lineTo(padding.left + w, midY);
      ctx.lineTo(padding.left, midY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    const above = ctx.createLinearGradient(0, padding.top, 0, midY);
    above.addColorStop(0, 'rgba(240, 240, 240, 0.25)');
    above.addColorStop(1, 'rgba(240, 240, 240, 0.05)');
    fillArea(above);
    const below = ctx.createLinearGradient(0, midY, 0, padding.top + h);
    below.addColorStop(0, 'rgba(68, 68, 68, 0.05)');
    below.addColorStop(1, 'rgba(68, 68, 68, 0.25)');
    fillArea(below);

    tracePath();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (marker !== null && marker >= 1 && marker <= data.length) {
      const mi = marker - 1;
      const mx = xAt(mi);
      const my = yAt(data[mi] ?? null);
      ctx.strokeStyle = COLORS.marker;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mx, padding.top);
      ctx.lineTo(mx, padding.top + h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.accent;
      ctx.fill();
      ctx.strokeStyle = COLORS.markerOutline;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.axis;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${EVAL_CLAMP_PAWNS}`, padding.left - 6, padding.top);
    ctx.fillText('0', padding.left - 6, midY);
    ctx.fillText(`-${EVAL_CLAMP_PAWNS}`, padding.left - 6, padding.top + h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const lastMove = Math.ceil(data.length / 2);
    const midMove = Math.ceil(lastMove / 2);
    ctx.fillText('1', padding.left, padding.top + h + 6);
    ctx.fillText(String(midMove), padding.left + w / 2, padding.top + h + 6);
    ctx.fillText(String(lastMove), padding.left + w, padding.top + h + 6);
  }

  // Redraw whenever the data or marker changes, and on resize so the
  // canvas backing store tracks its CSS size. Every reactive input is read
  // here, synchronously, so the effect tracks all of them.
  $effect(() => {
    const target = canvas;
    const data = evals;
    const marker = markerPly;
    const engineStart = enginePhaseStartPly;
    if (!target || !data) return;
    const draw = () => render(target, data, marker, engineStart);
    const frame = requestAnimationFrame(draw);
    window.addEventListener('resize', draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', draw);
    };
  });
</script>

<div class="timeline">
  {#if evals === null}
    <div class="loading">
      <span class="spinner"></span>
      Analyzing game... {progress}
    </div>
  {:else}
    <canvas bind:this={canvas}></canvas>
  {/if}
</div>

<style>
  .timeline {
    margin-top: 1rem;
    background: var(--panel);
    border-radius: 6px;
    padding: 0.75rem;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0.5rem 0;
  }

  canvas {
    width: 100%;
    height: 160px;
    display: block;
  }
</style>
