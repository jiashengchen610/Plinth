import * as React from "react"
import { cn } from "cn"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "@/icons"

// Colors and radius come from the component tokens in tokens/components/checkbox.tokens.json.

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-checkbox border border-checkbox-box-border bg-checkbox-box-background transition-shadow duration-(--duration-fast) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[state=checked]:border-checkbox-box-checked-border data-[state=checked]:bg-checkbox-box-checked-background data-[state=checked]:text-checkbox-box-checked-foreground data-[state=indeterminate]:border-checkbox-box-checked-border data-[state=indeterminate]:bg-checkbox-box-checked-background data-[state=indeterminate]:text-checkbox-box-checked-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current">
        {props.checked === "indeterminate" ? <MinusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
