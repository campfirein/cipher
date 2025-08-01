"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { HeaderProps } from "@/types/chat"
import { ActionBar } from "./action-bar"

export function Header({ 
  currentSessionId, 
  isWelcomeState, 
  onToggleSearch,
  onToggleSessions,
  onToggleServers,
  isSessionsPanelOpen,
  isServersPanelOpen 
}: HeaderProps) {
  return (
    <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex justify-between items-center px-4 py-3">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 text-primary-foreground">
              <img src="/cipher-logo.png" alt="Cipher" className="w-4 h-4" />
            </div>
            <h1 className="text-base font-semibold tracking-tight">Cipher</h1>
          </div>

          {currentSessionId && !isWelcomeState && (
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="text-xs">
                {currentSessionId}
              </Badge>
            </div>
          )}
        </div>

        <ActionBar 
          onToggleSearch={onToggleSearch}
          onToggleSessions={onToggleSessions}
          onToggleServers={onToggleServers}
          isSessionsPanelOpen={isSessionsPanelOpen}
          isServersPanelOpen={isServersPanelOpen}
        />
      </div>
    </header>
  );
}