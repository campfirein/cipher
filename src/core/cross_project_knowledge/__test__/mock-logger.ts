/**
 * Mock logger for testing
 */

export const logger = {
	info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
	warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
	error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
	debug: (message: string, meta?: any) => console.debug(`[DEBUG] ${message}`, meta || ''),
	verbose: (message: string, meta?: any) => console.log(`[VERBOSE] ${message}`, meta || ''),
	silly: (message: string, meta?: any) => console.log(`[SILLY] ${message}`, meta || ''),
	http: (message: string, meta?: any) => console.log(`[HTTP] ${message}`, meta || ''),
	displayAIResponse: (response: any) => console.log('[AI Response]', response),
	toolCall: (toolName: string, args: any) => console.log(`[Tool Call] ${toolName}`, args),
	toolResult: (result: any) => console.log('[Tool Result]', result),
	displayBox: (title: string, content: string, borderColor?: string) =>
		console.log(`[Box] ${title}: ${content}`),
	setLevel: (level: string) => console.log(`[Set Level] ${level}`),
	getLevel: () => 'info',
	setSilent: (silent: boolean) => console.log(`[Set Silent] ${silent}`),
	redirectToFile: (filePath: string) => console.log(`[Redirect to File] ${filePath}`),
	redirectToConsole: () => console.log('[Redirect to Console]'),
	createChild: (options?: any) => logger,
	getWinstonLogger: () => ({}),
};
