import * as React from "react"
import { cn } from "cn"

// Colors and radius come from the component tokens in tokens/components/textarea.tokens.json.

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-textarea border border-textarea-field-border bg-textarea-field-background px-2.5 py-2 text-base text-textarea-field-foreground transition-colors duration-(--duration-fast) outline-none placeholder:text-textarea-field-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
