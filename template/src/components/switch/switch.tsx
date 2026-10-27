import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

// Colors come from the component tokens in tokens/components/switch.tokens.json.

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors duration-(--duration-fast) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-switch-track-on data-[state=unchecked]:bg-switch-track-off",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full shadow-card ring-0 transition-transform duration-(--duration-fast) data-[state=checked]:translate-x-4 data-[state=checked]:bg-switch-thumb-on data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-switch-thumb-off"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
