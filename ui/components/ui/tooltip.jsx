"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Tooltip({ ...props }) {
  return <TooltipPrimitive.Provider delayDuration={300}>
    <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  </TooltipPrimitive.Provider>
}

function TooltipTrigger({ ...props }) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({ className, sideOffset = 6, children, ...props }) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn("z-50 max-w-64 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95", className)}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-primary" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
}

export { Tooltip, TooltipTrigger, TooltipContent }
