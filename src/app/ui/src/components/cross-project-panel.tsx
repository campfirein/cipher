/**
 * Cross-Project Knowledge Panel Component
 * 
 * Provides a sliding panel for cross-project knowledge management
 * with dashboard, configuration, and monitoring capabilities.
 * 
 * Why this exists: Users need easy access to cross-project knowledge
 * features through the main UI without navigating to separate pages.
 */

'use client';

import React from 'react';
import { CrossProjectDashboard } from './cross-project-dashboard';
import { Button } from './ui/button';
import { X, Settings, BarChart3 } from 'lucide-react';

interface CrossProjectPanelProps {
	isOpen: boolean;
	onClose: () => void;
}

export function CrossProjectPanel({ isOpen, onClose }: CrossProjectPanelProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
			<div
				className="fixed right-0 top-0 h-full w-96 bg-background border-l shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col h-full">
					{/* Header */}
					<div className="flex items-center justify-between p-4 border-b">
						<div className="flex items-center gap-2">
							<BarChart3 className="h-5 w-5" />
							<h2 className="text-lg font-semibold">Cross-Project Knowledge</h2>
						</div>
						<Button variant="ghost" size="sm" onClick={onClose}>
							<X className="h-4 w-4" />
						</Button>
					</div>

					{/* Content */}
					<div className="flex-1 overflow-y-auto p-4">
						<CrossProjectDashboard />
					</div>

					{/* Footer */}
					<div className="p-4 border-t bg-muted/50">
						<div className="text-xs text-muted-foreground text-center">
							Cross-project knowledge enables sharing patterns, solutions, and guidelines across projects
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
