"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { QuickActionCardProps } from "@/types/chat"
import { cn } from "@/lib/utils"

export function QuickActionCard({ action }: QuickActionCardProps) {
  return (
    <Card className="group hover:shadow-md transition-all duration-200 cursor-pointer border-border/50 hover:border-border">
      <CardContent className="p-4">
        <Button
          variant="ghost"
          onClick={action.action}
          className="w-full h-auto p-0 flex flex-col items-start space-y-2 hover:bg-transparent"
        >
          <div className="flex items-center space-x-2 w-full">
            <span className="text-lg" role="img" aria-label={action.title}>
              {action.icon}
            </span>
            <span className="font-medium text-sm text-left">{action.title}</span>
          </div>
          <p className="text-xs text-muted-foreground text-left w-full">
            {action.description}
          </p>
        </Button>
      </CardContent>
    </Card>
  );
}