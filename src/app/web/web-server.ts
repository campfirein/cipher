import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@core/logger/index.js';

export interface WebServerConfig {
	port: number;
	host?: string;
	apiUrl?: string;
	wsUrl?: string;
}

export class WebServerManager {
	private config: WebServerConfig;
	private process: ChildProcess | null = null;
	private uiPath: string;

	constructor(config: WebServerConfig) {
		this.config = config;
		// Resolve UI path relative to this file
		const currentFileUrl = import.meta.url;
		const currentFilePath = fileURLToPath(currentFileUrl);
		
		// Check if we're running from dist (compiled) or src (development)
		const isCompiledVersion = currentFilePath.includes('/dist/');
		
		if (isCompiledVersion) {
			// When running from dist/src/app/index.cjs, UI is at dist/src/app/ui
			// The bundled code is at dist/src/app/, so UI is in the same directory
			this.uiPath = path.resolve(path.dirname(currentFilePath), 'ui');
		} else {
			// When running from src/app/web/web-server.ts, UI is at src/app/ui
			this.uiPath = path.resolve(path.dirname(currentFilePath), '../ui');
		}
	}

	async start(): Promise<void> {
		logger.info(`Starting Web UI server on ${this.config.host || 'localhost'}:${this.config.port}`, null, 'green');

		// Check if UI directory exists
		if (!existsSync(this.uiPath)) {
			throw new Error(`UI directory not found at ${this.uiPath}`);
		}

		// Check if package.json exists in UI directory
		const packageJsonPath = path.join(this.uiPath, 'package.json');
		if (!existsSync(packageJsonPath)) {
			throw new Error(`UI package.json not found at ${packageJsonPath}`);
		}

		// Check if .next/standalone exists (production build)
		const standalonePath = path.join(this.uiPath, '.next', 'standalone');
		const standaloneServerPath = path.join(standalonePath, 'server.js');
		
		if (existsSync(standaloneServerPath)) {
			// Use production build
			await this.startProduction();
		} else {
			// Use development mode
			await this.startDevelopment();
		}
	}

	private async startProduction(): Promise<void> {
		const standalonePath = path.join(this.uiPath, '.next', 'standalone');
		const serverPath = path.join(standalonePath, 'server.js');

		logger.info('Using production build (standalone)', null, 'cyan');

		// Set environment variables
		const env = {
			...process.env,
			PORT: this.config.port.toString(),
			HOSTNAME: this.config.host || 'localhost',
			...(this.config.apiUrl && { API_URL: this.config.apiUrl }),
			...(this.config.wsUrl && { NEXT_PUBLIC_WS_URL: this.config.wsUrl }),
			// Extract port from API URL for Next.js rewrite rules
			...(this.config.apiUrl && { API_PORT: new URL(this.config.apiUrl).port || '3001' }),
		};

		this.process = spawn('node', [serverPath], {
			cwd: standalonePath,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.setupProcessHandlers();
	}

	private async startDevelopment(): Promise<void> {
		logger.info('Using development mode', null, 'cyan');

		// Check if node_modules exists, install if needed
		const nodeModulesPath = path.join(this.uiPath, 'node_modules');
		if (!existsSync(nodeModulesPath)) {
			logger.info('Installing UI dependencies...', null, 'yellow');
			await this.installDependencies();
		}

		// Set environment variables
		const env = {
			...process.env,
			PORT: this.config.port.toString(),
			...(this.config.apiUrl && { API_URL: this.config.apiUrl }),
			...(this.config.wsUrl && { NEXT_PUBLIC_WS_URL: this.config.wsUrl }),
			// Extract port from API URL for Next.js rewrite rules
			...(this.config.apiUrl && { API_PORT: new URL(this.config.apiUrl).port || '3001' }),
		};

		// Start development server with pnpm if available, otherwise npm
		const packageManager = this.detectPackageManager();
		this.process = spawn(packageManager, ['run', 'dev'], {
			cwd: this.uiPath,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.setupProcessHandlers();
	}

	private detectPackageManager(): string {
		// Check if pnpm-lock.yaml exists
		if (existsSync(path.join(this.uiPath, 'pnpm-lock.yaml'))) {
			return 'pnpm';
		}
		// Check if yarn.lock exists
		if (existsSync(path.join(this.uiPath, 'yarn.lock'))) {
			return 'yarn';
		}
		// Default to npm
		return 'npm';
	}

	private installDependencies(): Promise<void> {
		const packageManager = this.detectPackageManager();
		
		return new Promise((resolve, reject) => {
			const installProcess = spawn(packageManager, ['install'], {
				cwd: this.uiPath,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			installProcess.stdout?.on('data', (data) => {
				logger.debug(`${packageManager} install: ${data}`);
			});

			installProcess.stderr?.on('data', (data) => {
				logger.debug(`${packageManager} install error: ${data}`);
			});

			installProcess.on('close', (code) => {
				if (code === 0) {
					logger.info('UI dependencies installed successfully', null, 'green');
					resolve();
				} else {
					reject(new Error(`${packageManager} install failed with code ${code}`));
				}
			});

			installProcess.on('error', (error) => {
				reject(new Error(`Failed to install dependencies: ${error.message}`));
			});
		});
	}

	private setupProcessHandlers(): void {
		if (!this.process) return;

		this.process.stdout?.on('data', (data) => {
			const output = data.toString().trim();
			if (output) {
				logger.info(`[UI] ${output}`, null, 'cyan');
			}
		});

		this.process.stderr?.on('data', (data) => {
			const output = data.toString().trim();
			if (output && !output.includes('warn')) {
				logger.warn(`[UI] ${output}`, null, 'yellow');
			}
		});

		this.process.on('close', (code) => {
			if (code !== 0) {
				logger.error(`Web UI server exited with code ${code}`);
			} else {
				logger.info('Web UI server stopped', null, 'gray');
			}
		});

		this.process.on('error', (error) => {
			logger.error(`Web UI server error: ${error.message}`);
		});
	}

	stop(): void {
		if (this.process) {
			logger.info('Stopping Web UI server...', null, 'yellow');
			this.process.kill('SIGTERM');
			this.process = null;
		}
	}

	isRunning(): boolean {
		return this.process !== null && !this.process.killed;
	}
}