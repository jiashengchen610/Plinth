import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Colors and radius come from the component tokens in tokens/components/button.tokens.json
// (button-<variant>-background, -foreground, -border, -background-hover; button-radius); text from its text tokens
// per size (type-button-label, type-button-label-small).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-button border border-transparent bg-clip-padding whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-button-default-background text-button-default-foreground hover:bg-button-default-background-hover",
        outline:
          "border-button-outline-border bg-button-outline-background text-button-outline-foreground hover:bg-button-outline-background-hover aria-expanded:bg-button-outline-background-hover",
        secondary:
          "bg-button-secondary-background text-button-secondary-foreground hover:bg-button-secondary-background-hover aria-expanded:bg-button-secondary-background-hover",
        ghost:
          "text-button-ghost-foreground hover:bg-button-ghost-background-hover aria-expanded:bg-button-ghost-background-hover",
        destructive:
          "bg-button-destructive-background text-button-destructive-foreground hover:bg-button-destructive-background-hover focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link: "text-button-link-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 type-button-label has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 type-button-label-small has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 type-button-label-small has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 type-button-label has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 type-button-label",
        "icon-xs": "size-6 type-button-label-small [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 type-button-label-small",
        "icon-lg": "size-9 type-button-label",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
