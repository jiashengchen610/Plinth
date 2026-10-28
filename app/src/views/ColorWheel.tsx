// A color wheel in OKLCH, the space the engine makes palette scales in: the angle is the hue, the distance from the
// middle how strong the color is, and a slider sets how light. Drag or click on the wheel; arrow keys move the hue
// (left, right) and the strength (up, down). A hex field takes an exact color.
import { useEffect, useRef, useState } from "react";
import { hexToOklch, oklchToHex, type Oklch } from "@/lib/color";

const SIZE = 208, R = SIZE / 2;
/** Strength at the rim; stronger colors exist only at some hues and lightnesses. */
const MAX_C = 0.26;

export function ColorWheel({ value, onChange }: { value: Oklch; onChange: (v: Oklch) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(oklchToHex(value));
  useEffect(() => setHex(oklchToHex(value)), [value]);
  const pick = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const x = e.clientX - box.left - R, y = e.clientY - box.top - R;
    const h = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    onChange({ ...value, h, c: Math.min(1, Math.hypot(x, y) / R) * MAX_C });
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 5;
    const next = e.key === "ArrowLeft" ? { h: (value.h - step + 360) % 360 } : e.key === "ArrowRight" ? { h: (value.h + step) % 360 }
      : e.key === "ArrowUp" ? { c: Math.min(MAX_C, value.c + 0.01) } : e.key === "ArrowDown" ? { c: Math.max(0, value.c - 0.01) } : null;
    if (!next) return;
    e.preventDefault();
    onChange({ ...value, ...next });
  };
  // Drawn with the colors the picks become (strength reduced to what the screen shows, keeping the hue), not the
  // browser's own clipping, which shifts hues.
  const hues = Array.from({ length: 25 }, (_, i) => `${oklchToHex({ l: value.l, c: MAX_C, h: i * 15 })} ${i * 15}deg`).join(", ");
  const lights = Array.from({ length: 8 }, (_, i) => oklchToHex({ ...value, l: 0.25 + i * 0.1 })).join(", ");
  const r = Math.min(1, value.c / MAX_C) * R, rad = (value.h * Math.PI) / 180;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div ref={ref} role="slider" tabIndex={0} aria-label="Color wheel: hue and strength. Arrow keys left and right change the hue, up and down the strength."
        aria-valuetext={`Hue ${Math.round(value.h)}°, strength ${Math.round((value.c / MAX_C) * 100)}%`} aria-valuenow={Math.round(value.h)} aria-valuemin={0} aria-valuemax={360}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e); }} onKeyDown={key}
        className="relative flex-none cursor-crosshair touch-none rounded-full border outline-offset-4"
        style={{ width: SIZE, height: SIZE, background: `radial-gradient(closest-side, ${oklchToHex({ ...value, c: 0 })}, transparent), conic-gradient(${hues})` }}>
        <span aria-hidden="true" className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4),0_2px_6px_rgb(0_0_0/0.3)]"
          style={{ left: R + r * Math.sin(rad), top: R - r * Math.cos(rad), background: oklchToHex(value) }} />
      </div>
      <div className="flex min-w-40 flex-[1_1_160px] flex-col gap-3">
        <span className="h-14 rounded-xl border" style={{ background: oklchToHex(value) }} />
        <label className="flex flex-col gap-1 text-sm font-semibold">Light or dark
          <input type="range" min={0.25} max={0.95} step={0.005} value={value.l} onChange={(e) => onChange({ ...value, l: Number(e.target.value) })} aria-valuetext={`${Math.round(value.l * 100)}% light`}
            className="h-3 cursor-pointer appearance-none rounded-full" style={{ background: `linear-gradient(to right, ${lights})` }} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Exact color
          <input value={hex} spellCheck={false} onChange={(e) => { setHex(e.target.value); const v = /^#?[\da-f]{6}$/i.test(e.target.value.trim()) ? hexToOklch(e.target.value) : null; if (v) onChange(v); }} placeholder="#ca8a04" className="h-10 rounded-lg border bg-background px-3 font-mono text-sm font-normal" />
        </label>
      </div>
    </div>
  );
}
