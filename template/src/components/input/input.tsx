import * as React from "react"
import { cn } from "cn"

// Colors and radius come from the component tokens in tokens/components/input.tokens.json.

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-input border border-input-field-border bg-input-field-background px-2.5 py-1 type-input-field text-input-field-foreground max-md:text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:type-input-file file:text-input-field-foreground placeholder:text-input-field-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
