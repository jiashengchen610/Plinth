import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Toast as ToastPrimitive } from "radix-ui"
import { XIcon } from "@/icons"

// Colors, radius and shadow come from the component tokens in tokens/components/toast.tokens.json; toasts slide in
// with the motion tokens and stack at the toast layer. Wrap the app once in <ToastProvider> with a <ToastViewport />.

function ToastProvider(props: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />
}

function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn("fixed right-0 bottom-0 z-(--layer-toast) flex max-h-screen w-full flex-col gap-2 p-4 outline-none sm:max-w-sm", className)}
      {...props}
    />
  )
}

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-toast border p-4 pr-8 shadow-toast duration-(--duration-normal) ease-enter data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none",
  {
    variants: {
      variant: {
        default: "border-toast-default-border bg-toast-default-background text-toast-default-foreground *:data-[slot=toast-description]:text-toast-default-description",
        destructive: "border-toast-destructive-border bg-toast-destructive-background text-toast-destructive-foreground *:data-[slot=toast-description]:text-toast-destructive-description",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Toast({ className, variant, ...props }: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  return <ToastPrimitive.Root data-slot="toast" className={cn(toastVariants({ variant }), className)} {...props} />
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return <ToastPrimitive.Title data-slot="toast-title" className={cn("text-sm font-semibold", className)} {...props} />
}

function ToastDescription({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return <ToastPrimitive.Description data-slot="toast-description" className={cn("text-sm", className)} {...props} />
}

function ToastAction({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Action>) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      className={cn("inline-flex h-8 shrink-0 items-center justify-center rounded-toast border border-current/30 bg-transparent px-3 text-sm font-medium transition-colors duration-(--duration-fast) outline-none hover:bg-current/10 focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close"
      className={cn("absolute top-2 right-2 rounded-xs p-1 opacity-60 transition-opacity duration-(--duration-fast) outline-none hover:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitive.Close>
  )
}

export { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport, toastVariants }
