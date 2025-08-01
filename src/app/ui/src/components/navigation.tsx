"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Home, Layers, Settings } from "lucide-react"

export function Navigation() {
  const pathname = usePathname()

  const navItems = [
    {
      name: "Chat",
      href: "/",
      icon: Home,
      description: "Main chat interface"
    },
    {
      name: "Examples",
      href: "/examples", 
      icon: Layers,
      description: "View different implementations"
    }
  ]

  return (
    <nav className="flex items-center space-x-4 px-4 py-2 border-b border-border/50 bg-card/50">
      <div className="flex items-center space-x-2">
        <img src="/cipher-logo.png" alt="Cipher" className="w-6 h-6" />
        <span className="font-semibold">Cipher</span>
        <Badge variant="secondary" className="text-xs">
          v0.1.0
        </Badge>
      </div>

      <div className="flex items-center space-x-2 ml-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant={isActive ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "flex items-center space-x-2",
                  isActive && "bg-primary text-primary-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{item.name}</span>
              </Button>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}