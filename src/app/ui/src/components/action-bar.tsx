"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { 
  // Search,
  MessageSquare, 
  Package,
  X 
} from "lucide-react"
import { ActionBarProps } from "@/types/chat"
import { cn } from "@/lib/utils"

export function ActionBar({ 
  onToggleSearch,
  onToggleSessions, 
  onToggleServers,
  isSessionsPanelOpen,
  isServersPanelOpen 
}: ActionBarProps) {
  return (
    <div className="flex items-center space-x-2">
      {/* Search button - Temporarily disabled */}
      {/* <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSearch}
        className="h-8 w-8 p-0"
        title="Search (⌘⇧S)"
      >
        <Search className="w-4 h-4" />
      </Button> */}

      {/* Sessions panel toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSessions}
        className={cn(
          "h-8 w-8 p-0",
          isSessionsPanelOpen && "bg-muted"
        )}
        title="Sessions (⌘H)"
      >
        {isSessionsPanelOpen ? (
          <X className="w-4 h-4" />
        ) : (
          <MessageSquare className="w-4 h-4" />
        )}
      </Button>

      {/* Servers/Tools panel toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleServers}
        className={cn(
          "h-8 w-8 p-0",
          isServersPanelOpen && "bg-muted"
        )}
        title="Tools & Servers (⌘J)"
      >
        {isServersPanelOpen ? (
          <X className="w-4 h-4" />
        ) : (
          <Package className="w-4 h-4" />
        )}
      </Button>

    </div>
  );
}