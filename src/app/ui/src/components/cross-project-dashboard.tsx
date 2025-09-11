/**
 * Cross-Project Knowledge Dashboard Component
 * 
 * Provides a read-only dashboard for monitoring cross-project knowledge
 * transfer system status, metrics, and configuration.
 * 
 * Why this exists: Users need a visual interface to monitor and understand
 * the cross-project knowledge system without needing to use CLI commands.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Separator } from './ui/separator';
import { RefreshCw, Settings, BarChart3, Users, BookOpen, AlertCircle, CheckCircle } from 'lucide-react';

interface CrossProjectStatus {
	enabled: boolean;
	services: {
		crossProjectManager: boolean;
		memoryIntegrationManager: boolean;
	};
	configuration: {
		autoTransfer: boolean;
		masterGuides: boolean;
		performanceMonitoring: boolean;
		similarityThreshold: number;
		maxConcurrentTransfers: number;
		updateInterval: number;
	};
	timestamp: string;
}

interface CrossProjectHealth {
	healthy: boolean;
	status: 'disabled' | 'unavailable' | 'running';
	services: {
		crossProjectManager: {
			available: boolean;
		};
		memoryIntegrationManager: {
			available: boolean;
		};
	};
	timestamp: string;
}

interface CrossProjectMetrics {
	totalProjects: number;
	totalTransfers: number;
	totalMasterGuides: number;
	performanceMetrics: {
		transfersPerMinute: number;
		averageTransferTime: number;
		cacheHitRate: number;
		activeProjects: number;
	};
}

interface CrossProjectDashboardProps {
	className?: string;
}

export function CrossProjectDashboard({ className }: CrossProjectDashboardProps) {
	const [status, setStatus] = useState<CrossProjectStatus | null>(null);
	const [health, setHealth] = useState<CrossProjectHealth | null>(null);
	const [metrics, setMetrics] = useState<CrossProjectMetrics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchStatus = async () => {
		try {
			setLoading(true);
			setError(null);

			const [statusRes, healthRes] = await Promise.all([
				fetch('/api/cross-project/status'),
				fetch('/api/cross-project/health'),
			]);

			if (!statusRes.ok || !healthRes.ok) {
				throw new Error('Failed to fetch cross-project data');
			}

			const [statusData, healthData] = await Promise.all([
				statusRes.json(),
				healthRes.json(),
			]);

			setStatus(statusData.data || statusData);
			setHealth(healthData.data || healthData);

			// If system is enabled and running, fetch metrics
			if (statusData.enabled && healthData.healthy) {
				try {
					// This would be a real metrics endpoint
					// For now, we'll simulate some metrics
					setMetrics({
						totalProjects: 5,
						totalTransfers: 23,
						totalMasterGuides: 3,
						performanceMetrics: {
							transfersPerMinute: 2.1,
							averageTransferTime: 150,
							cacheHitRate: 0.85,
							activeProjects: 5,
						},
					});
				} catch (metricsError) {
					console.warn('Failed to fetch metrics:', metricsError);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchStatus();
	}, []);

	const getStatusColor = (enabled: boolean, healthy: boolean) => {
		if (!enabled) return 'bg-gray-500';
		if (!healthy) return 'bg-red-500';
		return 'bg-green-500';
	};

	const getStatusText = (enabled: boolean, healthy: boolean) => {
		if (!enabled) return 'Disabled';
		if (!healthy) return 'Unavailable';
		return 'Running';
	};

	if (loading) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<RefreshCw className="h-5 w-5 animate-spin" />
						Cross-Project Knowledge
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<div className="text-muted-foreground">Loading...</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<AlertCircle className="h-5 w-5 text-red-500" />
						Cross-Project Knowledge
					</CardTitle>
				</CardHeader>
				<CardContent>
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							Failed to load cross-project knowledge data: {error}
						</AlertDescription>
					</Alert>
					<Button onClick={fetchStatus} className="mt-4" variant="outline">
						<RefreshCw className="h-4 w-4 mr-2" />
						Retry
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className={className}>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<BookOpen className="h-5 w-5" />
							Cross-Project Knowledge
						</div>
						<div className="flex items-center gap-2">
							<div
								className={`h-3 w-3 rounded-full ${getStatusColor(
									status?.enabled || false,
									health?.healthy || false
								)}`}
							/>
							<span className="text-sm text-muted-foreground">
								{getStatusText(status?.enabled || false, health?.healthy || false)}
							</span>
							<Button onClick={fetchStatus} variant="ghost" size="sm">
								<RefreshCw className="h-4 w-4" />
							</Button>
						</div>
					</CardTitle>
					<CardDescription>
						Monitor knowledge sharing and transfer across projects
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{!status?.enabled ? (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								Cross-project knowledge system is disabled. Enable it by setting{' '}
								<code className="bg-muted px-1 rounded">CIPHER_CROSS_PROJECT_ENABLED=true</code> in your
								environment.
							</AlertDescription>
						</Alert>
					) : (
						<>
							{/* System Status */}
							<div className="space-y-4">
								<h3 className="text-lg font-semibold flex items-center gap-2">
									<Settings className="h-4 w-4" />
									System Status
								</h3>
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-2">
										<div className="text-sm font-medium">Services</div>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												{status?.services.crossProjectManager ? (
													<CheckCircle className="h-4 w-4 text-green-500" />
												) : (
													<AlertCircle className="h-4 w-4 text-red-500" />
												)}
												<span className="text-sm">Cross-Project Manager</span>
											</div>
											<div className="flex items-center gap-2">
												{status?.services.memoryIntegrationManager ? (
													<CheckCircle className="h-4 w-4 text-green-500" />
												) : (
													<AlertCircle className="h-4 w-4 text-red-500" />
												)}
												<span className="text-sm">Memory Integration</span>
											</div>
										</div>
									</div>
									<div className="space-y-2">
										<div className="text-sm font-medium">Features</div>
										<div className="space-y-1">
											<Badge variant={status?.configuration.autoTransfer ? 'default' : 'secondary'}>
												Auto Transfer
											</Badge>
											<Badge variant={status?.configuration.masterGuides ? 'default' : 'secondary'}>
												Master Guides
											</Badge>
											<Badge variant={status?.configuration.performanceMonitoring ? 'default' : 'secondary'}>
												Performance Monitoring
											</Badge>
										</div>
									</div>
								</div>
							</div>

							<Separator />

							{/* Metrics */}
							{metrics && (
								<div className="space-y-4">
									<h3 className="text-lg font-semibold flex items-center gap-2">
										<BarChart3 className="h-4 w-4" />
										Metrics
									</h3>
									<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
										<div className="text-center">
											<div className="text-2xl font-bold">{metrics.totalProjects}</div>
											<div className="text-sm text-muted-foreground">Projects</div>
										</div>
										<div className="text-center">
											<div className="text-2xl font-bold">{metrics.totalTransfers}</div>
											<div className="text-sm text-muted-foreground">Transfers</div>
										</div>
										<div className="text-center">
											<div className="text-2xl font-bold">{metrics.totalMasterGuides}</div>
											<div className="text-sm text-muted-foreground">Master Guides</div>
										</div>
										<div className="text-center">
											<div className="text-2xl font-bold">
												{metrics.performanceMetrics.transfersPerMinute.toFixed(1)}
											</div>
											<div className="text-sm text-muted-foreground">Transfers/min</div>
										</div>
									</div>
								</div>
							)}

							<Separator />

							{/* Configuration */}
							<div className="space-y-4">
								<h3 className="text-lg font-semibold flex items-center gap-2">
									<Settings className="h-4 w-4" />
									Configuration
								</h3>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
									<div className="space-y-2">
										<div className="flex justify-between">
											<span className="text-muted-foreground">Similarity Threshold:</span>
											<span>{status?.configuration.similarityThreshold || '0.7'}</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted-foreground">Max Concurrent Transfers:</span>
											<span>{status?.configuration.maxConcurrentTransfers || '5'}</span>
										</div>
									</div>
									<div className="space-y-2">
										<div className="flex justify-between">
											<span className="text-muted-foreground">Update Interval:</span>
											<span>
												{status?.configuration.updateInterval
													? `${(status.configuration.updateInterval / 1000 / 60).toFixed(0)} min`
													: '60 min'}
											</span>
										</div>
									</div>
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
