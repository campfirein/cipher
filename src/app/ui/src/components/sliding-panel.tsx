"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SlidingPanelProps } from "@/types/chat"

export function SlidingPanel({ 
  isOpen, 
  width = "w-80", 
  children, 
  side = "right" 
}: SlidingPanelProps) {
  return (
    <div className={cn(
      "shrink-0 transition-all duration-300 ease-in-out border-border/50 bg-card",
      side === "right" ? "border-l" : "border-r",
      isOpen ? width : "w-0 overflow-hidden"
    )}>
      {isOpen && children}
    </div>
  );
}