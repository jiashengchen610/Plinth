import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Colors and radius come from the component tokens in tokens/components/badge.tokens.json.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-badge border border-transparent px-2 py-0.5 type-badge-text whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-badge-default-background text-badge-default-foreground [a]:hover:opacity-80",
        secondary: "bg-badge-secondary-background text-badge-secondary-foreground [a]:hover:opacity-80",
        destructive:
          "bg-badge-destructive-background text-badge-destructive-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:opacity-80",
        success: "bg-badge-success-background text-badge-success-foreground [a]:hover:opacity-80",
        warning: "bg-badge-warning-background text-badge-warning-foreground [a]:hover:opacity-80",
        info: "bg-badge-info-background text-badge-info-foreground [a]:hover:opacity-80",
        outline: "border-badge-outline-border text-badge-outline-foreground [a]:hover:opacity-80",
        ghost: "text-badge-ghost-foreground hover:bg-badge-ghost-background-hover",
        link: "text-badge-link-foreground underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
