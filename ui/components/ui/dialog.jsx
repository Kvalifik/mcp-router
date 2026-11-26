import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogCloseButton({ className }) {
  return <DialogPrimitive.Close asChild>
    <Button type="button" variant="ghost" size="icon-sm" data-slot="dialog-close" aria-label="Close"
      className={cn("text-muted-foreground hover:text-foreground", className)}>
      <XIcon />
    </Button>
  </DialogPrimitive.Close>
}

function DialogTitleRow({ className, children }) {
  return <div data-slot="dialog-title-row" className="flex min-w-0 items-center gap-2">
    <div className={cn("flex min-w-0 flex-1 items-center gap-1", className)}>{children}</div>
    <DialogCloseButton />
  </div>
}

function DialogOverlay({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  workspaceOpen,
  showCloseButton = true,
  ...props
}) {
  const body = <>{children}{showCloseButton && <DialogCloseButton className="absolute top-4 right-4" />}</>
  const panel = "grid w-full gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg"
  if (workspaceOpen !== undefined) {
    return <div data-slot="dialog-overlay" data-state={workspaceOpen ? "open" : "closed"} className="workspace-overlay">
      <DialogPrimitive.Content data-slot="dialog-workarea" className="dialog-viewport" style={{pointerEvents:"none"}}
        onInteractOutside={event => {
          // Toolbar menus and notifications can receive focus and clicks alongside the panel.
          if (event.detail.originalEvent.type !== "pointerdown" || !event.target.matches?.(".workspace-overlay")) event.preventDefault()
        }} {...props}>
        <div data-slot="dialog-content" className={cn(panel, className)} onKeyDown={event => {
          // Let the browser tab between the panel and toolbar in normal document order.
          if (event.key === "Tab") event.stopPropagation()
        }}>{body}</div>
      </DialogPrimitive.Content>
    </div>
  }
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay>
          <DialogPrimitive.Content data-slot="dialog-content" className={cn(panel,
            "fixed top-1/2 left-1/2 z-50 max-w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2", className)} {...props}>
            {body}
          </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("type-heading", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitleRow,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
