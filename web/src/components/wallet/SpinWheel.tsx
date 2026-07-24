'use client';
import { useEffect, useRef } from 'react';
import type { SpinSlice } from '@barkath/shared';

/**
 * Spin wheel — visually matched to the User App's wheel (Flutter CustomPainter):
 * a segmented pie with a metallic rim + bolts, radial labels, a gold centre
 * "SPIN" hub and a gold top pointer. Rendered on a <canvas>; the wheel element
 * rotates via a CSS transform that mirrors the app's easeOutCubic settle.
 *
 * Purely presentational — the spin logic, Firebase calls and result navigation
 * stay in the rewards page. `deg` is the caller-controlled rotation.
 */

const WHEEL_COLORS = ['#E08A3C', '#16324D', '#2E6CA4', '#D23197'];
const SIZE = 300;
const DPR = 2;

/** Matches the app: Curves.easeOutCubic over ~3.4s. */
export const SPIN_TRANSITION = 'transform 3.4s cubic-bezier(0.33, 1, 0.68, 1)';

export function SpinWheel({
  slices,
  deg,
  disabled,
  onSpin,
}: {
  slices: SpinSlice[];
  deg: number;
  disabled: boolean;
  onSpin: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    draw(canvasRef.current, slices);
    // Re-draw once webfonts are ready so labels use Manrope, not the fallback.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) draw(canvasRef.current, slices);
    });
    return () => {
      cancelled = true;
    };
  }, [slices]);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE, maxWidth: '100%' }}>
      <canvas
        ref={canvasRef}
        width={SIZE * DPR}
        height={SIZE * DPR}
        style={{
          width: SIZE,
          height: SIZE,
          transform: `rotate(${deg}deg)`,
          transition: SPIN_TRANSITION,
        }}
      />
      {/* Centre hub — also a tap target to spin, like the app. */}
      <button
        type="button"
        onClick={onSpin}
        disabled={disabled}
        aria-label="Spin"
        className="absolute left-1/2 top-1/2 flex h-[74px] w-[74px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full disabled:cursor-not-allowed"
        style={{
          background: '#DAA227',
          border: '3px solid #B88A1E',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <span className="font-display text-[15px] font-extrabold tracking-wide text-black">
          SPIN
        </span>
      </button>
      {/* Top pointer — gold triangle pointing down into the wheel. */}
      <div
        className="absolute left-1/2 top-0 -translate-x-1/2"
        style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))' }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: '13px solid transparent',
            borderRight: '13px solid transparent',
            borderTop: '22px solid #DAA227',
          }}
        />
      </div>
    </div>
  );
}

function draw(canvas: HTMLCanvasElement | null, slices: SpinSlice[]): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  const r = SIZE / 2;
  const cx = r;
  const cy = r;
  const rim = 14;
  const wheelR = r - 2;
  const innerR = wheelR - rim;
  const n = slices.length;
  if (n === 0) return;
  const sweep = (2 * Math.PI) / n;

  // Metallic rim.
  ctx.beginPath();
  ctx.arc(cx, cy, wheelR, 0, 2 * Math.PI);
  ctx.fillStyle = '#AEB6C0';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8B94A0';
  ctx.stroke();

  // Segments (start at the top, clockwise — matches the app's landing math).
  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + i * sweep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, start, start + sweep);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
  }

  // Radial labels, centred in each segment (flip on the left half to stay upright).
  ctx.fillStyle = '#ffffff';
  ctx.font = "700 12px Manrope, system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + (i + 0.5) * sweep;
    const label = slices[i]?.displayLabel ?? '';
    if (!label) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.translate(innerR * 0.6, 0);
    if (mid > Math.PI / 2 && mid < (3 * Math.PI) / 2) ctx.rotate(Math.PI);
    drawWrappedLabel(ctx, label, innerR * 0.64);
    ctx.restore();
  }

  // Rim bolts at each segment boundary.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * sweep;
    const px = cx + Math.cos(a) * (wheelR - rim / 2);
    const py = cy + Math.sin(a) * (wheelR - rim / 2);
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** Draw a label on up to two lines so long prizes ("Better luck next time") fit. */
function drawWrappedLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): void {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, 0, 0);
    return;
  }
  const words = text.split(' ');
  let line1 = '';
  let line2 = '';
  for (const w of words) {
    if (!line2 && ctx.measureText((line1 ? `${line1} ` : '') + w).width <= maxWidth) {
      line1 = line1 ? `${line1} ${w}` : w;
    } else {
      line2 = line2 ? `${line2} ${w}` : w;
    }
  }
  ctx.fillText(line1, 0, -7);
  ctx.fillText(line2, 0, 7);
}
