"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErrorNotificationProps } from "@/types/chat"

export function ErrorNotification({ 
  message, 
  onDismiss 
}: ErrorNotificationProps) {
  if (!message) return null;

  return (
    <div className="absolute top-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg">
      <div className="flex items-center justify-between">
        <span>{message}</span>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={onDismiss} 
          className="ml-2 h-auto p-1 text-destructive-foreground/80 hover:text-destructive-foreground hover:bg-destructive-foreground/10"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}