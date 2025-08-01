import winston from 'winston';
import chalk from 'chalk';
import boxen from 'boxen';
import fs from 'fs';
import path from 'path';
import { env } from '../env.js';

// ===== 1. Foundation Layer: Winston Configuration =====

const logLevels = {
	error: 0, // Highest priority
	warn: 1,
	info: 2,
	http: 3,
	verbose: 4,
	debug: 5,
	silly: 6, // Lowest priority
};

// ===== 2. Security Layer: Data Redaction =====

const SENSITIVE_KEYS = ['apiKey', 'password', 'secret', 'token', 'auth', 'key', 'credential'];
const MASK_REGEX = new RegExp(
	`(${SENSITIVE_KEYS.join('|')})(["']?\\s*[:=]\\s*)(["'])?.*?\\3`,
	'gi'
);

const redactSensitiveData = (message: string): string => {
	const shouldRedact = env.REDACT_SECRETS !== false;
	if (!shouldRedact) return message;

	return message.replace(MASK_REGEX, (match, key, separator, quote) => {
		const quoteMark = quote || '';
		return `${key}${separator}${quoteMark}***REDACTED***${quoteMark}`;
	});
};

// ===== 3. Visual Formatting Layer =====

type ChalkColor =
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan'
	| 'white'
	| 'gray'
	| 'redBright'
	| 'greenBright'
	| 'yellowBright'
	| 'blueBright'
	| 'magentaBright'
	| 'cyanBright'
	| 'whiteBright';

const levelColorMap: Record<string, (text: string) => string> = {
	error: chalk.red,
	warn: chalk.yellow,
	info: chalk.blue,
	http: chalk.cyan,
	verbose: chalk.magenta,
	debug: chalk.gray,
	silly: chalk.gray.dim,
};

// Create custom format for masking
const maskFormat = winston.format(info => {
	if (typeof info.message === 'string') {
		info.message = redactSensitiveData(info.message);
	}
	return info;
});

// Console formatting
const consoleFormat = winston.format.printf(({ level, message, timestamp, color }) => {
	const colorize = levelColorMap[level] || chalk.white;
	let formattedMessage = message;

	// Apply custom color if specified
	if (color && chalk[color as ChalkColor]) {
		formattedMessage = (chalk[color as ChalkColor] as any)(message);
	}

	return `${chalk.dim(timestamp)} ${colorize(level.toUpperCase())}: ${formattedMessage}`;
});

// File formatting (no colors)
const fileFormat = winston.format.printf(({ level, message, timestamp }) => {
	return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

// ===== 4. Configuration Layer =====

const getDefaultLogLevel = (): string => {
	const envLevel = env.CIPHER_LOG_LEVEL;
	if (envLevel && Object.keys(logLevels).includes(envLevel.toLowerCase())) {
		return envLevel.toLowerCase();
	}
	return 'info'; // Safe default
};

// ===== 5. Logger Options Interface =====

export interface LoggerOptions {
	level?: string;
	silent?: boolean;
	file?: string;
}

// ===== 6. Core Logger Class =====

export class Logger {
	private logger: winston.Logger;
	private isSilent: boolean = false;

	constructor(options: LoggerOptions = {}) {
		const level = options.level || getDefaultLogLevel();
		this.isSilent = options.silent || false;

		// Create the winston logger
		this.logger = winston.createLogger({
			levels: logLevels,
			level: level,
			format: winston.format.combine(
				winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
				maskFormat()
			),
			transports: this.createTransports(options.file),
			silent: this.isSilent,
		});

		// Add colors to winston
		winston.addColors({
			error: 'red',
			warn: 'yellow',
			info: 'blue',
			http: 'cyan',
			verbose: 'magenta',
			debug: 'gray',
			silly: 'gray',
		});
	}

	private createTransports(filePath?: string): winston.transport[] {
		const transports: winston.transport[] = [];

		if (filePath) {
			// File transport
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			transports.push(
				new winston.transports.File({
					filename: filePath,
					format: winston.format.combine(
						winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
						maskFormat(),
						fileFormat
					),
				})
			);
		} else {
			// Console transport
			transports.push(
				new winston.transports.Console({
					format: winston.format.combine(
						winston.format.timestamp({ format: 'HH:mm:ss' }),
						maskFormat(),
						consoleFormat
					),
					stderrLevels: Object.keys(logLevels), // Redirect all log levels to stderr
				})
			);
		}

		return transports;
	}

	// ===== Core Logging Methods =====

	error(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.error(message, { ...meta, color });
	}

	warn(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.warn(message, { ...meta, color });
	}

	info(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.info(message, { ...meta, color });
	}

	http(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.http(message, { ...meta, color });
	}

	verbose(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.verbose(message, { ...meta, color });
	}

	debug(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.debug(message, { ...meta, color });
	}

	silly(message: string, meta?: any, color?: ChalkColor): void {
		this.logger.silly(message, { ...meta, color });
	}

	// ===== Specialized Display Features =====

	displayAIResponse(response: any): void {
		if (this.isSilent) return;

		const content =
			typeof response === 'string'
				? response
				: response?.content || JSON.stringify(response, null, 2);

		console.log(
			boxen(chalk.white(content), {
				padding: 1,
				borderColor: 'yellow',
				title: '🤖 AI Response',
				titleAlignment: 'center',
			})
		);
	}

	toolCall(toolName: string, args: any): void {
		if (this.isSilent) return;

		const argsString = typeof args === 'string' ? args : JSON.stringify(args, null, 2);

		console.log(
			boxen(
				`${chalk.cyan('Tool Call')}: ${chalk.yellow(toolName)}\n` +
					`${chalk.dim('Arguments')}:\n${chalk.white(argsString)}`,
				{
					padding: 1,
					borderColor: 'blue',
					title: '🔧 Tool Call',
					titleAlignment: 'center',
				}
			)
		);
	}

	toolResult(result: any): void {
		if (this.isSilent) return;

		const resultString = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

		console.log(
			boxen(chalk.green(resultString), {
				padding: 1,
				borderColor: 'green',
				title: '✅ Tool Result',
				titleAlignment: 'center',
			})
		);
	}

	displayBox(title: string, content: string, borderColor: ChalkColor = 'white'): void {
		if (this.isSilent) return;

		console.log(
			boxen(content, {
				padding: 1,
				borderColor: borderColor,
				title: title,
				titleAlignment: 'center',
			})
		);
	}

	// ===== Runtime Configuration Management =====

	setLevel(level: string): void {
		if (Object.keys(logLevels).includes(level.toLowerCase())) {
			this.logger.level = level.toLowerCase();
			if (!this.isSilent) {
				console.log(`Log level set to: ${level}`);
			}
		} else {
			this.error(`Invalid log level: ${level}. Valid levels: ${Object.keys(logLevels).join(', ')}`);
		}
	}

	getLevel(): string {
		return this.logger.level;
	}

	setSilent(silent: boolean): void {
		this.isSilent = silent;
		this.logger.silent = silent;
	}

	redirectToFile(filePath: string): void {
		try {
			// Ensure directory exists
			fs.mkdirSync(path.dirname(filePath), { recursive: true });

			// Clear existing transports
			this.logger.clear();

			// Add file transport
			this.logger.add(
				new winston.transports.File({
					filename: filePath,
					format: winston.format.combine(
						winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
						maskFormat(),
						fileFormat
					),
				})
			);

			// Update state
			this.isSilent = true;

			if (!this.isSilent) {
				console.log(`Logger redirected to file: ${filePath}`);
			}
		} catch (error) {
			this.error(`Failed to redirect logger to file: ${error}`);
		}
	}

	redirectToConsole(): void {
		try {
			// Clear existing transports
			this.logger.clear();

			// Add console transport
			this.logger.add(
				new winston.transports.Console({
					format: winston.format.combine(
						winston.format.timestamp({ format: 'HH:mm:ss' }),
						maskFormat(),
						consoleFormat
					),
					stderrLevels: Object.keys(logLevels), // Redirect all log levels to stderr
				})
			);

			// Update state
			this.isSilent = false;

			console.log('Logger redirected to console');
		} catch (error) {
			this.error(`Failed to redirect logger to console: ${error}`);
		}
	}

	// ===== Utility Methods =====

	createChild(options: LoggerOptions = {}): Logger {
		const childOptions: LoggerOptions = {
			level: options.level || this.getLevel(),
			silent: options.silent !== undefined ? options.silent : this.isSilent,
		};

		// Only include file option if it's defined
		if (options.file !== undefined) {
			childOptions.file = options.file;
		}

		return new Logger(childOptions);
	}

	// Get logger instance for advanced usage
	getWinstonLogger(): winston.Logger {
		return this.logger;
	}
}

// ===== 8. Singleton Pattern =====

export const logger = new Logger();

// ===== Export Types =====

export type { ChalkColor };

// ===== Utility Functions =====

export const createLogger = (options: LoggerOptions = {}): Logger => {
	return new Logger(options);
};

export const setGlobalLogLevel = (level: string): void => {
	logger.setLevel(level);
};

export const getGlobalLogLevel = (): string => {
	return logger.getLevel();
};
