"use client"

import * as React from "react"
import { WelcomeScreenProps } from "@/types/chat"
import { QuickActionCard } from "./quick-action-card"

export function WelcomeScreen({ quickActions }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-2xl bg-primary/10 text-primary">
            <img src="/cipher-logo.png" alt="Cipher" className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight font-mono bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent text-center">
              Hello, Welcome to Cipher!
            </h2>
            <p className="text-muted-foreground text-base text-center">
              Ask anything or connect new tools to expand what you can do.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
          {quickActions.map((action, index) => (
            <QuickActionCard key={index} action={action} />
          ))}
        </div>

        <div className="text-xs text-muted-foreground space-y-1 text-center">
          <p>💡 Try <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘K</kbd> for new chat, <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘J</kbd> for tools</p>
        </div>
      </div>
    </div>
  );
}