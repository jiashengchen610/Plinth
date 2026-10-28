import * as React from "react"
import { cn } from "cn"

// A frosted panel over photos and color. The material-glass utility (base token material.glass, its recipe in
// $extensions.plinth.glass) tints and blurs what is behind it and lights its edge; corners, text color and text style
// come from tokens/components/glass.tokens.json (glass-radius, glass-panel-foreground, type-glass-text). In Chromium
// the recipe's ripple (distortion) also bends what is behind it a little. Browsers that cannot blur, and systems that
// ask for less transparency, get the solid glass color, so text on it stays readable.

let next = 0

type Ripple = { id: string; scale: number }

/** The ripple filter, when the recipe asks for one and the browser can apply it behind an element (Chromium). */
function useRipple(ref: React.RefObject<HTMLDivElement | null>) {
  const [ripple, setRipple] = React.useState<Ripple | null>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const strength = parseFloat(getComputedStyle(el).getPropertyValue("--material-glass-distortion")) || 0
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? []
    const chromium = brands.some((b) => b.brand === "Chromium")
    const less = window.matchMedia("(prefers-reduced-transparency: reduce)").matches
    setRipple(strength > 0 && chromium && !less ? { id: `glass-ripple-${++next}`, scale: Math.round(strength * 40) } : null)
  }, [ref])
  return ripple
}

function Glass({ className, style, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const ripple = useRipple(ref)
  return (
    <div
      ref={ref}
      data-slot="glass"
      className={cn("relative rounded-glass material-glass type-glass-text text-glass-panel-foreground", className)}
      style={ripple ? { ...style, backdropFilter: `url(#${ripple.id}) blur(var(--material-glass-blur)) saturate(var(--material-glass-saturation))` } : style}
      {...props}
    >
      {ripple && (
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <filter id={ripple.id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves={1} seed={3} result="ripple" />
            <feDisplacementMap in="SourceGraphic" in2="ripple" scale={ripple.scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  )
}

export { Glass }
