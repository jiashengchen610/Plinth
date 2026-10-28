import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Colors and radius come from the component tokens in tokens/components/alert.tokens.json
// (alert-<variant>-background, -foreground, -border, -icon, -description; alert-radius); text from its text tokens
// (type-alert-title, type-alert-description).
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-alert border px-4 py-3 type-alert-description has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-alert-default-border bg-alert-default-background text-alert-default-foreground [&>svg]:text-alert-default-icon *:data-[slot=alert-description]:text-alert-default-description",
        destructive: "border-alert-destructive-border bg-alert-destructive-background text-alert-destructive-foreground [&>svg]:text-alert-destructive-icon *:data-[slot=alert-description]:text-alert-destructive-description",
        success: "border-alert-success-border bg-alert-success-background text-alert-success-foreground [&>svg]:text-alert-success-icon *:data-[slot=alert-description]:text-alert-success-description",
        warning: "border-alert-warning-border bg-alert-warning-background text-alert-warning-foreground [&>svg]:text-alert-warning-icon *:data-[slot=alert-description]:text-alert-warning-description",
        info: "border-alert-info-border bg-alert-info-background text-alert-info-foreground [&>svg]:text-alert-info-icon *:data-[slot=alert-description]:text-alert-info-description",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("col-start-2 line-clamp-1 min-h-4 type-alert-title", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 grid justify-items-start gap-1 type-alert-description", className)} {...props} />
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
