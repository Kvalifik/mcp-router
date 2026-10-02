"use client"

import * as React from "react"
import { buttonVariants } from "./button.jsx"
import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import { Accordion as AccordionPrimitive } from "radix-ui"

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  headerClassName,
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & { headerClassName?: string }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <AccordionPrimitive.Header className={cn("flex", headerClassName)}>
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        onFocus={event => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocused(false)}
        className={cn(
          "flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]_[data-slot=accordion-chevron]_svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <span data-slot="accordion-chevron" className="pointer-events-none relative inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true"><span data-slot="accordion-chevron-feedback" data-hovered={focused} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "absolute pointer-events-auto")}><ChevronDownIcon className="size-4 text-foreground transition-transform duration-200 motion-reduce:transition-none" /></span></span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
