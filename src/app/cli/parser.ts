import chalk from 'chalk';
import { MemAgent } from '@core/index.js';
import { EnhancedPromptManager } from '@core/brain/systemPrompt/enhanced-manager.js';

/**
 * Interface for command execution results
 */
export interface CommandResult {
	success: boolean;
	message?: string;
	data?: any;
}

/**
 * Interface for command definition with hierarchical support
 */
export interface CommandDefinition {
	name: string;
	description: string;
	usage?: string;
	aliases?: string[];
	category?: string;
	handler: (args: string[], agent: MemAgent) => Promise<boolean>;
	subcommands?: CommandDefinition[];
}

/**
 * Input classification result
 */
export interface ParsedInput {
	isCommand: boolean;
	command?: string;
	args?: string[];
	rawInput: string;
}

/**
 * Command suggestion for auto-completion
 */
export interface CommandSuggestion {
	name: string;
	description: string;
	category?: string;
}

/**
 * Comprehensive command parser for Cipher CLI
 */
export class CommandParser {
	private commands: Map<string, CommandDefinition> = new Map();
	private aliases: Map<string, string> = new Map();

	constructor() {
		this.initializeCommands();
	}

	/**
	 * Parse input to determine if it's a command or regular prompt
	 */
	parseInput(input: string): ParsedInput {
		const trimmed = input.trim();

		// Check if input starts with slash (command indicator)
		if (trimmed.startsWith('/')) {
			// Parse as slash command
			const parts = trimmed
				.slice(1)
				.split(' ')
				.filter(part => part.length > 0);
			const command = parts[0] || '';
			const args = parts.slice(1);

			return {
				isCommand: true,
				command,
				args,
				rawInput: input,
			};
		} else {
			// Treat as regular user prompt
			return {
				isCommand: false,
				rawInput: input,
			};
		}
	}

	/**
	 * Execute a parsed command
	 */
	async executeCommand(command: string, args: string[], agent: MemAgent): Promise<boolean> {
		try {
			const commandDef =
				this.commands.get(command) || this.commands.get(this.aliases.get(command) || '');
			if (!commandDef) {
				console.log(chalk.red(`❌ Unknown command: /${command}`));
				console.log(chalk.gray('💡 Use /help to see all available commands'));
				return false;
			}

			// Handle subcommands
			if (commandDef.subcommands && args.length > 0) {
				const subcommandName = args[0];
				if (subcommandName) {
					// Add null check
					const subcommand = commandDef.subcommands.find(
						sub => sub.name === subcommandName || sub.aliases?.includes(subcommandName)
					);

					if (subcommand) {
						return await subcommand.handler(args.slice(1), agent);
					}
				}
			}

			return await commandDef.handler(args, agent);
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Error executing command /${command}: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Get command suggestions for auto-completion
	 */
	getCommandSuggestions(partial: string): CommandSuggestion[] {
		const suggestions: CommandSuggestion[] = [];

		// Check main commands
		for (const [name, definition] of this.commands) {
			if (name.startsWith(partial)) {
				suggestions.push({
					name,
					description: definition.description,
					category: definition.category || 'uncategorized', // Add fallback for undefined
				});
			}
		}

		// Check aliases
		for (const [alias, actualCommand] of this.aliases) {
			if (alias.startsWith(partial)) {
				const commandDef = this.commands.get(actualCommand);
				if (commandDef) {
					suggestions.push({
						name: alias,
						description: `${commandDef.description} (alias)`,
						category: commandDef.category || 'uncategorized', // Add fallback for undefined
					});
				}
			}
		}

		// Sort suggestions alphabetically
		return suggestions.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Format command help - supports both basic and detailed modes
	 */
	formatCommandHelp(commandName: string, detailed: boolean = false): string {
		const commandDef = this.commands.get(commandName);
		if (!commandDef) {
			return chalk.red(`Command not found: ${commandName}`);
		}

		let help = chalk.cyan(`/${commandName}`) + ` - ${commandDef.description}`;

		if (detailed) {
			if (commandDef.usage) {
				help += `\n  ${chalk.yellow('Usage:')} ${commandDef.usage}`;
			}

			if (commandDef.aliases && commandDef.aliases.length > 0) {
				help += `\n  ${chalk.yellow('Aliases:')} ${commandDef.aliases.map(a => chalk.cyan(`/${a}`)).join(', ')}`;
			}

			if (commandDef.subcommands && commandDef.subcommands.length > 0) {
				help += `\n  ${chalk.yellow('Subcommands:')}`;
				for (const sub of commandDef.subcommands) {
					help += `\n    ${chalk.cyan(`/${commandName} ${sub.name}`)} - ${sub.description}`;
				}
			}
		}

		return help;
	}

	/**
	 * Display all commands in categorized format
	 */
	displayAllCommands(): void {
		// Define category order
		const categoryOrder = ['basic', 'memory', 'session', 'tools', 'system', 'help'];

		// Initialize empty categories
		const categorizedCommands: Map<string, CommandDefinition[]> = new Map();
		const uncategorizedCommands: CommandDefinition[] = [];

		// Initialize categories
		categoryOrder.forEach(cat => categorizedCommands.set(cat, []));

		// Categorize each command
		for (const commandDef of this.commands.values()) {
			const category = commandDef.category || 'uncategorized';
			if (categorizedCommands.has(category)) {
				categorizedCommands.get(category)!.push(commandDef);
			} else {
				uncategorizedCommands.push(commandDef);
			}
		}

		console.log(chalk.cyan('\n📋 Available Commands:\n'));

		// Display in predefined order
		for (const category of categoryOrder) {
			const commands = categorizedCommands.get(category);
			if (commands && commands.length > 0) {
				console.log(chalk.yellow(`${category.toUpperCase()}:`));
				for (const cmd of commands.sort((a, b) => a.name.localeCompare(b.name))) {
					console.log(`  ${this.formatCommandHelp(cmd.name, false)}`);
				}
				console.log('');
			}
		}

		// Show uncategorized commands last
		if (uncategorizedCommands.length > 0) {
			console.log(chalk.yellow('OTHER:'));
			for (const cmd of uncategorizedCommands.sort((a, b) => a.name.localeCompare(b.name))) {
				console.log(`  ${this.formatCommandHelp(cmd.name, false)}`);
			}
			console.log('');
		}

		console.log(
			chalk.gray('💡 Use /help <command> for detailed information about a specific command')
		);
		console.log(chalk.gray('💡 Use <Tab> for command auto-completion'));
	}

	/**
	 * Display basic help information
	 */
	displayHelp(commandName?: string): void {
		if (commandName) {
			console.log('\n' + this.formatCommandHelp(commandName, true) + '\n');
		} else {
			this.displayAllCommands();
		}
	}

	/**
	 * Register a new command
	 */
	registerCommand(definition: CommandDefinition): void {
		this.commands.set(definition.name, definition);

		// Register aliases
		if (definition.aliases) {
			for (const alias of definition.aliases) {
				this.aliases.set(alias, definition.name);
			}
		}
	}

	/**
	 * Check if a command exists
	 */
	hasCommand(command: string): boolean {
		return this.commands.has(command) || this.aliases.has(command);
	}

	/**
	 * Get all registered commands
	 */
	getAllCommands(): CommandDefinition[] {
		return Array.from(this.commands.values());
	}

	/**
	 * Initialize built-in commands
	 */
	private initializeCommands(): void {
		// Help command
		this.registerCommand({
			name: 'help',
			description: 'Show help information for commands',
			usage: '/help [command]',
			aliases: ['h', '?'],
			category: 'help',
			handler: async (args: string[]) => {
				try {
					if (args.length > 0) {
						// Show specific command help
						const commandName = args[0];
						if (commandName && this.hasCommand(commandName)) {
							// Add null check
							this.displayHelp(commandName);
						} else {
							console.log(chalk.red(`❌ Unknown command: ${commandName || 'undefined'}`));
							console.log(chalk.gray('💡 Use /help to see all available commands'));
						}
					} else {
						// Display all commands categorized
						this.displayHelp();
					}
					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Error displaying help: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Exit command
		this.registerCommand({
			name: 'exit',
			description: 'Exit the CLI session',
			aliases: ['quit', 'q'],
			category: 'basic',
			handler: async () => {
				try {
					console.log(chalk.yellow('👋 Goodbye! Your conversation has been saved to memory.'));
					process.exit(0);
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Error during exit: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Load history command
		this.registerCommand({
			name: 'load-history',
			description: 'Load conversation history for current session',
			category: 'session',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const currentSessionId = agent.getCurrentSessionId();
					console.log(
						chalk.cyan(`🔄 Loading conversation history for session: ${currentSessionId}`)
					);

					await agent.loadSessionHistory(currentSessionId);

					// Show the loaded history
					const history = await agent.getCurrentSessionHistory();
					console.log(
						chalk.green(
							`✅ Successfully loaded ${history.length} messages from conversation history`
						)
					);

					if (history.length > 0) {
						console.log(chalk.gray('Recent messages:'));
						history.slice(-3).forEach((msg, index) => {
							const role = msg.role || 'unknown';
							const content =
								typeof msg.content === 'string'
									? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')
									: JSON.stringify(msg.content).substring(0, 80) + '...';
							console.log(chalk.gray(`  ${history.length - 3 + index + 1}. [${role}] ${content}`));
						});
					}

					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to load conversation history: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return false;
				}
			},
		});

		// Debug command
		this.registerCommand({
			name: 'debug',
			description: 'Show debug information for current session',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const currentSessionId = agent.getCurrentSessionId();
					console.log(chalk.cyan('🔍 Debug Information:'));
					console.log(chalk.gray(`Current Session: ${currentSessionId}`));

					// Get session metadata
					const metadata = await agent.getSessionMetadata(currentSessionId);
					if (metadata) {
						console.log(chalk.gray(`Message Count: ${metadata.messageCount}`));
					}

					// Get conversation history
					const history = await agent.getCurrentSessionHistory();
					console.log(chalk.gray(`History Length: ${history.length}`));

					if (history.length > 0) {
						console.log(chalk.gray('Recent Messages:'));
						history.slice(-5).forEach((msg, index) => {
							const role = msg.role || 'unknown';
							const content =
								typeof msg.content === 'string'
									? msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
									: JSON.stringify(msg.content).substring(0, 100) + '...';
							console.log(chalk.gray(`  ${history.length - 5 + index + 1}. [${role}] ${content}`));
						});
					} else {
						console.log(chalk.gray('  No conversation history found'));
					}

					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to get debug info: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return false;
				}
			},
		});

		// Clear/Reset command
		this.registerCommand({
			name: 'clear',
			description: 'Reset conversation history for current session',
			aliases: ['reset'],
			category: 'basic',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					// Create a new session to effectively reset conversation
					await agent.createSession('default');
					console.log(chalk.green('🔄 Conversation history reset successfully'));
					console.log(chalk.gray('💡 Starting fresh with a clean session'));
					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to reset conversation: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Config command
		this.registerCommand({
			name: 'config',
			description: 'Display current configuration',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const config = agent.getEffectiveConfig();

					console.log(chalk.cyan('⚙️  Current Configuration:'));
					console.log('');

					// LLM Configuration
					console.log(chalk.yellow('🤖 LLM Configuration:'));
					console.log(`  ${chalk.gray('Provider:')} ${config.llm.provider}`);
					console.log(`  ${chalk.gray('Model:')} ${config.llm.model}`);
					console.log(`  ${chalk.gray('Max Iterations:')} ${config.llm.maxIterations || 10}`);
					if (config.llm.baseURL) {
						console.log(`  ${chalk.gray('Base URL:')} ${config.llm.baseURL}`);
					}
					console.log('');

					// Session Configuration
					console.log(chalk.yellow('📊 Session Configuration:'));
					console.log(`  ${chalk.gray('Max Sessions:')} ${config.sessions?.maxSessions || 100}`);
					console.log(
						`  ${chalk.gray('Session TTL:')} ${((config.sessions?.sessionTTL || 3600000) / 1000 / 60).toFixed(0)} minutes`
					);
					console.log('');

					// MCP Servers
					console.log(chalk.yellow('🔗 MCP Servers:'));
					if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
						for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
							// Handle different MCP server config types
							let serverType = 'unknown';
							if ('command' in serverConfig && serverConfig.command) {
								serverType = serverConfig.command[0] || 'stdio';
							} else if ('url' in serverConfig && serverConfig.url) {
								serverType = 'sse';
							} else if (serverConfig.type) {
								serverType = serverConfig.type;
							}
							console.log(`  ${chalk.gray('•')} ${name} (${serverType})`);
						}
					} else {
						console.log(`  ${chalk.gray('No MCP servers configured')}`);
					}
					console.log('');

					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Stats command
		this.registerCommand({
			name: 'stats',
			description: 'Show system statistics and metrics',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					console.log(chalk.cyan('📈 System Statistics:'));
					console.log('');

					// Session Statistics
					console.log(chalk.yellow('📊 Session Metrics:'));
					const sessionCount = await agent.sessionManager.getSessionCount();
					const activeSessionIds = await agent.sessionManager.getActiveSessionIds();
					console.log(`  ${chalk.gray('Active Sessions:')} ${sessionCount}`);
					console.log(
						`  ${chalk.gray('Session IDs:')} ${activeSessionIds.length > 0 ? activeSessionIds.join(', ') : 'none'}`
					);
					console.log('');

					// MCP Server Statistics
					console.log(chalk.yellow('🔗 MCP Server Stats:'));
					const mcpClients = agent.getMcpClients();
					const failedConnections = agent.getMcpFailedConnections();
					console.log(`  ${chalk.gray('Connected Servers:')} ${mcpClients.size}`);
					console.log(
						`  ${chalk.gray('Failed Connections:')} ${Object.keys(failedConnections).length}`
					);

					if (mcpClients.size > 0) {
						console.log(`  ${chalk.gray('Active Clients:')}`);
						for (const [name] of mcpClients) {
							console.log(`    ${chalk.gray('•')} ${name}`);
						}
					}

					if (Object.keys(failedConnections).length > 0) {
						console.log(`  ${chalk.gray('Failed Servers:')}`);
						for (const [name, error] of Object.entries(failedConnections)) {
							console.log(`    ${chalk.gray('•')} ${name} (${error})`);
						}
					}
					console.log('');

					// Tool Statistics
					console.log(chalk.yellow('🔧 Tool Stats:'));
					try {
						const allTools = await agent.getAllMcpTools();
						const toolCount = Object.keys(allTools).length;
						console.log(`  ${chalk.gray('Available MCP Tools:')} ${toolCount}`);

						if (toolCount > 0) {
							const toolNames = Object.keys(allTools).slice(0, 5); // Show first 5
							console.log(
								`  ${chalk.gray('Sample Tools:')} ${toolNames.join(', ')}${toolCount > 5 ? '...' : ''}`
							);
						}
					} catch {
						console.log(`  ${chalk.gray('Tool Count:')} Error retrieving tools`);
					}
					console.log('');

					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to get statistics: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Tools command
		this.registerCommand({
			name: 'tools',
			description: 'List all available tools',
			category: 'tools',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					console.log(chalk.cyan('🔧 Available Tools:'));
					console.log('');

					const allTools = await agent.getAllMcpTools();
					const toolEntries = Object.entries(allTools);

					if (toolEntries.length === 0) {
						console.log(chalk.gray('  No tools available'));
						console.log(chalk.gray('  💡 Try connecting to MCP servers to access tools'));
						return true;
					}

					// Group tools by server/source
					const toolsByServer: Record<string, Array<{ name: string; description: string }>> = {};

					for (const [toolName, toolDef] of toolEntries) {
						// Extract server name from tool name or use 'unknown'
						let serverName = 'unknown';
						if (typeof toolDef === 'object' && toolDef !== null && 'source' in toolDef) {
							serverName = String(toolDef.source);
						} else {
							// Try to extract from tool name prefix
							const parts = toolName.split('_');
							if (parts.length > 1 && parts[0]) {
								serverName = parts[0];
							}
						}

						if (!toolsByServer[serverName]) {
							toolsByServer[serverName] = [];
						}

						let description = 'No description available';
						if (typeof toolDef === 'object' && toolDef !== null) {
							if ('description' in toolDef && typeof toolDef.description === 'string') {
								description = toolDef.description;
							} else if (
								'inputSchema' in toolDef &&
								typeof toolDef.inputSchema === 'object' &&
								toolDef.inputSchema !== null &&
								'description' in toolDef.inputSchema
							) {
								description = String(toolDef.inputSchema.description);
							}
						}

						toolsByServer[serverName]!.push({
							name: toolName,
							description: description,
						});
					}

					// Display tools grouped by server
					for (const [serverName, tools] of Object.entries(toolsByServer)) {
						console.log(chalk.yellow(`📦 ${serverName.toUpperCase()}:`));

						tools.sort((a, b) => a.name.localeCompare(b.name));
						for (const tool of tools) {
							const truncatedDesc =
								tool.description.length > 80
									? tool.description.substring(0, 80) + '...'
									: tool.description;
							console.log(`  ${chalk.cyan(tool.name)} - ${truncatedDesc}`);
						}
						console.log('');
					}

					console.log(chalk.gray(`Total: ${toolEntries.length} tools available`));
					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to list tools: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return true;
				}
			},
		});

		// Prompt command
		this.registerCommand({
			name: 'prompt',
			description: 'Display current system prompt',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const promptManager = agent.promptManager;
					let systemPrompt = '';
					// EnhancedPromptManager: use async generateSystemPrompt
					if (typeof (promptManager as any).generateSystemPrompt === 'function') {
						// Use cached content for dynamic/file-based providers
						const sessionId = agent.getCurrentSessionId && agent.getCurrentSessionId();
						let storageManager = undefined;
						if (
							agent.sessionManager &&
							typeof agent.sessionManager.getStorageManagerForSession === 'function' &&
							sessionId
						) {
							storageManager = agent.sessionManager.getStorageManagerForSession(sessionId);
						}
						// Pass a flag to skip regeneration (if supported)
						const result = await (promptManager as any).generateSystemPrompt({
							sessionId,
							metadata: { storageManager },
							useCache: true,
						});
						systemPrompt = result.content || '';
					} else {
						throw new Error('No compatible prompt manager found');
					}

					console.log(chalk.cyan('📝 Current System Prompt:'));
					console.log('');
					console.log(chalk.gray('╭─ System Prompt ─────────────────────────────────────────╮'));

					// Split prompt into lines and format with borders
					const lines = systemPrompt.split('\n');
					for (const line of lines) {
						// Wrap long lines
						if (line.length > 55) {
							const words = line.split(' ');
							let currentLine = '';

							for (const word of words) {
								if ((currentLine + word).length > 55) {
									if (currentLine) {
										console.log(chalk.gray('│ ') + currentLine.padEnd(55) + chalk.gray(' │'));
										currentLine = word + ' ';
									} else {
										// Word itself is too long, truncate
										console.log(
											chalk.gray('│ ') +
												(word.substring(0, 52) + '...').padEnd(55) +
												chalk.gray(' │')
										);
									}
								} else {
									currentLine += word + ' ';
								}
							}

							if (currentLine.trim()) {
								console.log(chalk.gray('│ ') + currentLine.trim().padEnd(55) + chalk.gray(' │'));
							}
						} else {
							console.log(chalk.gray('│ ') + line.padEnd(55) + chalk.gray(' │'));
						}
					}

					console.log(chalk.gray('╰─────────────────────────────────────────────────────────╯'));
					console.log('');

					console.log(chalk.gray(`💡 Prompt length: ${systemPrompt.length} characters`));
					console.log(chalk.gray(`💡 Line count: ${lines.length} lines`));

					return true;
				} catch (error) {
					console.error(chalk.red('❌ Error displaying system prompt:'), error);
					return false;
				}
			},
		});

		// Session command with subcommands
		this.registerCommand({
			name: 'session',
			description: 'Manage conversation sessions',
			usage: '/session <subcommand> [args]',
			aliases: ['s'],
			category: 'session',
			handler: async (args: string[], agent: MemAgent) => {
				// Default to help if no subcommand
				if (args.length === 0) {
					return this.sessionHelpHandler([], agent);
				}

				// Route to subcommand
				const subcommand = args[0];
				const subArgs = args.slice(1);

				switch (subcommand) {
					case 'list':
					case 'ls':
						return this.sessionListHandler(subArgs, agent);
					case 'new':
					case 'create':
						return this.sessionNewHandler(subArgs, agent);
					case 'switch':
					case 'sw':
						return this.sessionSwitchHandler(subArgs, agent);
					case 'current':
					case 'curr':
						return this.sessionCurrentHandler(subArgs, agent);
					case 'delete':
					case 'del':
					case 'remove':
						return this.sessionDeleteHandler(subArgs, agent);
					case 'save':
						return this.sessionSaveHandler(subArgs, agent);
					case 'load':
					case 'restore':
						return this.sessionLoadHandler(subArgs, agent);
					case 'help':
					case 'h':
						return this.sessionHelpHandler(subArgs, agent);
					default:
						console.log(chalk.red(`❌ Unknown session subcommand: ${subcommand}`));
						console.log(chalk.gray('💡 Use /session help to see available subcommands'));
						return false;
				}
			},
		});

		// Prompt management commands
		this.registerCommand({
			name: 'prompt-stats',
			description: 'Show system prompt performance statistics',
			usage: '/prompt-stats [--detailed]',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const detailed = args.includes('--detailed');
					console.log(chalk.cyan('📊 System Prompt Performance Statistics'));
					console.log(chalk.cyan('====================================='));

					const promptManager = agent.promptManager;
					if (typeof (promptManager as any).generateSystemPrompt === 'function') {
						// Patch: Pass sessionId and storageManager in context
						const sessionId = agent.getCurrentSessionId && agent.getCurrentSessionId();
						let storageManager = undefined;
						if (
							agent.sessionManager &&
							typeof agent.sessionManager.getStorageManagerForSession === 'function' &&
							sessionId
						) {
							storageManager = agent.sessionManager.getStorageManagerForSession(sessionId);
						}
						const result = await (promptManager as any).generateSystemPrompt({
							sessionId,
							metadata: { storageManager },
						});
						console.log(chalk.yellow('🚀 **Enhanced Generation Performance**'));
						console.log(`   - Providers used: ${result.providerResults.length}`);
						console.log(`   - Total prompt length: ${result.content.length} characters`);
						console.log(`   - Generation time: ${result.generationTimeMs} ms`);
						console.log(`   - Success: ${result.success ? '✅' : '❌'}`);
						if (detailed) {
							console.log(chalk.yellow('📈 **Per-Provider Breakdown**'));
							for (const r of result.providerResults) {
								console.log(
									`   - ${r.providerId}: ${r.success ? '✅' : '❌'} | ${r.generationTimeMs} ms | ${r.content.length} chars`
								);
							}
						}
						if (result.errors && result.errors.length > 0) {
							console.log(chalk.red('❌ Errors:'));
							for (const err of result.errors) {
								console.log(`   - ${err.message}`);
							}
						}
						return true;
					} else {
						throw new Error('No compatible prompt manager found');
					}
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Failed to get prompt statistics: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return false;
				}
			},
		});

		this.registerCommand({
			name: 'prompt-providers',
			description: 'Manage system prompt providers',
			usage: '/prompt-providers <subcommand> [args]',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					if (args.length === 0) {
						console.log(chalk.red('❌ Subcommand required'));
						console.log(
							chalk.gray(
								'Available subcommands: list, add-dynamic, add-file, remove, update, enable, disable, help'
							)
						);
						console.log(chalk.gray('Usage: /prompt-providers <subcommand> [args]'));
						return false;
					}
					const subcommand = args[0];
					const subArgs = args.slice(1);
					const promptManager = agent.promptManager;
					// EnhancedPromptManager logic
					const isEnhanced = typeof (promptManager as any).listProviders === 'function';
					if (!isEnhanced) {
						console.log('❌ Prompt provider management is only available in enhanced mode.');
						return false;
					}
					// Now safe to cast
					const enhanced = promptManager as unknown as EnhancedPromptManager;
					switch (subcommand) {
						case 'list': {
							// Get all currently loaded (active) providers
							const activeProviders = enhanced.listProviders();
							// Get all provider configs from configManager (for preview)
							const allConfigs = enhanced.getConfig().providers;
							console.log(chalk.cyan('📋 System Prompt Providers (Enhanced Mode)'));
							// Active providers only
							if (activeProviders.length > 0) {
								console.log(chalk.green('🟢 Active Providers:'));
								for (const p of activeProviders) {
									let preview = '';
									if (p.type === 'static') {
										const config = allConfigs.find(c => c.name === p.id);
										if (config && typeof config.config?.content === 'string') {
											preview = config.config.content.substring(0, 60);
											if (config.config.content.length > 60) preview += '...';
											preview = ` | Preview: "${preview.replace(/\n/g, ' ')}"`;
										}
									}
									console.log(`  🟢 ${p.id} (${p.type})${preview}`);
								}
							} else {
								console.log(chalk.gray('  No active providers.'));
							}
							console.log('');
							console.log(
								chalk.gray(
									'💡 Use /prompt-providers show-all to see all available and disabled providers.'
								)
							);
							console.log(
								chalk.gray(
									'💡 Use /prompt-providers add-dynamic or add-file to activate more providers.'
								)
							);
							return true;
						}
						case 'add-dynamic': {
							if (subArgs.length < 1) {
								console.log(chalk.red('❌ Generator name required'));
								console.log(
									chalk.gray('Usage: /prompt-providers add-dynamic <generator> [--history N|all]')
								);
								return false;
							}
							const generator = subArgs[0];
							let history = '';
							for (let i = 1; i < subArgs.length; ++i) {
								if (subArgs[i] === '--history') {
									history = subArgs[i + 1] ?? '';
								}
							}
							const config = {
								name: generator,
								type: 'dynamic',
								priority: 50,
								enabled: true,
								config: { generator, history },
							};
							await enhanced.addOrUpdateProvider(config);
							console.log(chalk.green(`✅ Dynamic provider '${generator}' added/updated.`));
							// Immediately trigger LLM to generate the summary and cache it
							const sessionId = agent.getCurrentSessionId && agent.getCurrentSessionId();
							let storageManager = undefined;
							if (
								agent.sessionManager &&
								typeof agent.sessionManager.getStorageManagerForSession === 'function' &&
								sessionId
							) {
								storageManager = agent.sessionManager.getStorageManagerForSession(sessionId);
							}
							const result = await enhanced.generateSystemPrompt({
								sessionId,
								metadata: { storageManager },
							});
							// Find the providerResult for the new dynamic provider
							const summaryResult = result.providerResults.find(
								r => r.providerId === generator && r.success && r.content.trim()
							);
							// Set the cached content on the provider instance
							if (typeof generator === 'string') {
								const providerInstance = enhanced.getProvider(generator);
								if (
									providerInstance &&
									'setCachedContent' in providerInstance &&
									typeof providerInstance.setCachedContent === 'function'
								) {
									providerInstance.setCachedContent(summaryResult ? summaryResult.content : '');
								}
							}
							if (summaryResult) {
								console.log(chalk.cyan(`📝 Generated summary for '${generator}':`));
								console.log(summaryResult.content);
							} else {
								// Fallback: show any error or message
								const errorResult = result.providerResults.find(r => r.providerId === generator);
								if (errorResult && errorResult.content) {
									console.log(chalk.yellow(`⚠️  ${errorResult.content}`));
								} else {
									console.log(chalk.yellow('⚠️  No summary content generated.'));
								}
							}
							return true;
						}
						case 'add-file': {
							if (subArgs.length < 1) {
								console.log(chalk.red('❌ Provider name required'));
								console.log(
									chalk.gray(
										'Usage: /prompt-providers add-file <name> [<path>] [--summarize true|false]'
									)
								);
								return false;
							}
							const name = subArgs[0];
							let filePath: string | undefined = undefined;
							let summarize: boolean | undefined = undefined;
							// Parse args for filePath and --summarize
							let i = 1;
							while (i < subArgs.length) {
								if (subArgs[i] === '--summarize' && subArgs[i + 1]) {
									summarize = subArgs[i + 1] === 'true';
									i += 2;
								} else if (!filePath) {
									filePath = subArgs[i];
									i++;
								} else {
									i++;
								}
							}
							// If filePath or summarize is missing, get from config
							const allConfigs = enhanced.getConfig().providers;
							const configFromFile = allConfigs.find(
								c => c.name === name && c.type === 'file-based'
							);
							if (!configFromFile) {
								console.log(chalk.red(`❌ File-based provider '${name}' not found in config`));
								return false;
							}
							if (!filePath) filePath = configFromFile.config?.filePath;
							if (summarize === undefined) summarize = configFromFile.config?.summarize ?? false;
							if (!filePath) {
								console.log(
									chalk.red(
										`❌ File path for provider '${name}' is not specified and not found in config`
									)
								);
								return false;
							}
							const config = {
								name,
								type: 'file-based',
								priority: configFromFile.priority ?? 40,
								enabled: true,
								config: { filePath, summarize },
							};
							await enhanced.addOrUpdateProvider(config);
							// Immediately trigger summarization if summarize is true
							if (summarize) {
								// Get the provider instance
								if (typeof name === 'string') {
									const provider = enhanced.getProvider(name);
									if (provider && typeof provider.generateContent === 'function') {
										// Try to get llmService from agent (if available)
										const llmService = agent.services && agent.services.llmService;
										const sessionId = agent.getCurrentSessionId && agent.getCurrentSessionId();
										const context = {
											timestamp: new Date(),
											sessionId: sessionId || '',
											metadata: { llmService },
										};
										try {
											await provider.generateContent(context);
											console.log(
												chalk.gray('💡 LLM summary generated and cached for file-based provider.')
											);
										} catch {
											console.log(
												chalk.yellow(
													'⚠️  LLM summarization failed to cache immediately, will retry on next /prompt.'
												)
											);
										}
									}
								}
							}
							console.log(chalk.green(`✅ File-based provider '${name}' added/updated.`));
							return true;
						}
						case 'remove': {
							const name = subArgs[0] ?? '';
							await enhanced.removeProvider(name);
							console.log(chalk.green(`✅ Provider '${name}' removed.`));
							return true;
						}
						case 'update': {
							const name = subArgs[0] ?? '';
							const provider = enhanced.getProvider(name);
							if (!provider) {
								console.log(chalk.red(`❌ Provider '${name}' not found`));
								return false;
							}
							// Use safe object spread for config
							const configObj =
								provider &&
								typeof (provider as any).config === 'object' &&
								(provider as any).config !== null
									? { ...(provider as any).config }
									: {};
							const newConfig = { ...provider, config: configObj };
							let summarizeFlag: boolean | undefined = undefined;
							for (let i = 1; i < subArgs.length; ++i) {
								if (subArgs[i] === '--summarize' && subArgs[i + 1]) {
									summarizeFlag = subArgs[i + 1] === 'true';
									newConfig.config['summarize'] = summarizeFlag;
									i++;
								} else {
									const [key, value] = (subArgs[i] ?? '').split('=');
									if (key && value !== undefined) {
										newConfig.config[key] = value;
									}
								}
							}
							await enhanced.addOrUpdateProvider(newConfig);
							// Fetch the new provider instance after update
							// const updatedProvider = enhanced.getProvider(name);
							// If summarize flag is set to true for file-based provider, trigger LLM summarization immediately
							if (summarizeFlag && typeof name === 'string') {
								const updatedProvider = enhanced.getProvider(name);
								if (updatedProvider && typeof updatedProvider.generateContent === 'function') {
									const llmService = agent.services && agent.services.llmService;
									const sessionId = agent.getCurrentSessionId && agent.getCurrentSessionId();
									const context = {
										timestamp: new Date(),
										sessionId: sessionId || '',
										metadata: { llmService },
									};
									try {
										await updatedProvider.generateContent(context);
										console.log(
											chalk.gray('💡 LLM summary generated and cached for file-based provider.')
										);
									} catch {
										console.log(
											chalk.yellow(
												'⚠️  LLM summarization failed to cache immediately, will retry on next /prompt.'
											)
										);
									}
								}
							}
							console.log(chalk.green(`✅ Provider '${name}' updated.`));
							return true;
						}
						case 'enable': {
							if (subArgs.length === 0) {
								console.log(chalk.red('❌ Provider name required'));
								console.log(chalk.gray('Usage: /prompt-providers enable <provider-name>'));
								return false;
							}
							const providerName = subArgs[0];
							// Try to get from loaded providers first
							let provider: ReturnType<typeof enhanced.getProvider> | undefined = undefined;
							if (typeof providerName === 'string') {
								provider = enhanced.getProvider(providerName);
							}
							// If not loaded, update config in configManager
							if (!provider) {
								const allConfigs = enhanced.getConfig().providers;
								const config = allConfigs.find(c => c.name === providerName);
								if (!config) {
									console.log(chalk.red(`❌ Provider '${providerName}' not found in config`));
									return false;
								}
								config.enabled = true;
								console.log(
									chalk.green(
										`✅ Provider '${providerName}' enabled (config updated, will take effect if loaded).`
									)
								);
								return true;
							}
							provider.enabled = true;
							console.log(chalk.green(`✅ Provider '${providerName}' enabled.`));
							return true;
						}
						case 'disable': {
							if (subArgs.length === 0) {
								console.log(chalk.red('❌ Provider name required'));
								console.log(chalk.gray('Usage: /prompt-providers disable <provider-name>'));
								return false;
							}
							const providerName = subArgs[0];
							// Try to get from loaded providers first
							let provider: ReturnType<typeof enhanced.getProvider> | undefined = undefined;
							if (typeof providerName === 'string') {
								provider = enhanced.getProvider(providerName);
							}
							// If not loaded, update config in configManager
							if (!provider) {
								const allConfigs = enhanced.getConfig().providers;
								const config = allConfigs.find(c => c.name === providerName);
								if (!config) {
									console.log(chalk.red(`❌ Provider '${providerName}' not found in config`));
									return false;
								}
								config.enabled = false;
								console.log(
									chalk.green(
										`✅ Provider '${providerName}' disabled (config updated, will take effect if loaded).`
									)
								);
								return true;
							}
							provider.enabled = false;
							console.log(chalk.green(`✅ Provider '${providerName}' disabled.`));
							return true;
						}
						case 'show-all': {
							// Get all provider configs from configManager (including those not loaded)
							const allConfigs = enhanced.getConfig().providers;
							// Get all currently loaded (active) providers
							const activeProviders = enhanced.listProviders();
							// Build a set of active provider names for quick lookup
							const activeNames = new Set(activeProviders.map(p => p.id));
							// All enabled and disabled providers
							const enabledProviders = allConfigs.filter(c => c.enabled);
							const disabledProviders = allConfigs.filter(c => !c.enabled);
							// Split enabled into active and available
							const activeEnabled = enabledProviders.filter(c => activeNames.has(c.name));
							const availableEnabled = enabledProviders.filter(c => !activeNames.has(c.name));
							// Output
							console.log(chalk.cyan('📋 All Providers (Enabled and Disabled)'));
							// Active enabled
							if (activeEnabled.length > 0) {
								console.log(chalk.green('🟢 Active:'));
								for (const c of activeEnabled) {
									let preview = '';
									if (c.type === 'static' && typeof c.config?.content === 'string') {
										preview = c.config.content.substring(0, 60);
										if (c.config.content.length > 60) preview += '...';
										preview = ` | Preview: "${preview.replace(/\n/g, ' ')}"`;
									}
									console.log(`  🟢 ${c.name} (${c.type})${preview}`);
								}
							} else {
								console.log(chalk.gray('  No active enabled providers.'));
							}
							// Available enabled
							if (availableEnabled.length > 0) {
								console.log(chalk.yellow('🟡 Available (Enabled, Not Yet Loaded):'));
								for (const c of availableEnabled) {
									let preview = '';
									if (c.type === 'static' && typeof c.config?.content === 'string') {
										preview = c.config.content.substring(0, 60);
										if (c.config.content.length > 60) preview += '...';
										preview = ` | Preview: "${preview.replace(/\n/g, ' ')}"`;
									}
									console.log(`  🟡 ${c.name} (${c.type})${preview}`);
								}
							} else {
								console.log(chalk.gray('  No available enabled providers.'));
							}
							// Disabled providers
							if (disabledProviders.length > 0) {
								console.log(chalk.red('🔴 Disabled:'));
								for (const c of disabledProviders) {
									let preview = '';
									if (c.type === 'static' && typeof c.config?.content === 'string') {
										preview = c.config.content.substring(0, 60);
										if (c.config.content.length > 60) preview += '...';
										preview = ` | Preview: "${preview.replace(/\n/g, ' ')}"`;
									}
									console.log(chalk.red(`  🔴 ${c.name} (${c.type})${preview}`));
								}
							} else {
								console.log(chalk.gray('  No disabled providers.'));
							}
							console.log('');
							console.log(chalk.gray('💡 All providers listed here are from config.'));
							console.log(
								chalk.gray('💡 Use /prompt-providers enable/disable to manage provider status.')
							);
							return true;
						}
						case 'help': {
							console.log(chalk.cyan('\n📋 Prompt Provider Management Commands:\n'));
							console.log(chalk.yellow('Available subcommands:'));
							const subcommands = [
								'/prompt-providers list - List active and available prompt providers',
								'/prompt-providers show-all - Show all enabled providers (active + available)',
								'/prompt-providers add-dynamic <generator> [--history N|all] - Add/update a dynamic provider',
								'/prompt-providers add-file <name> <path> [--summarize true|false] - Add/update a file-based provider',
								'/prompt-providers remove <name> - Remove a provider',
								'/prompt-providers update <name> key=value ... - Update provider config',
								'/prompt-providers enable <name> - Enable a provider (if supported)',
								'/prompt-providers disable <name> - Disable a provider (if supported)',
								'/prompt-providers help - Show this help message',
							];
							subcommands.forEach(cmd => console.log(`  ${cmd}`));
							console.log(
								'\n' +
									chalk.gray('💡 Providers are components that generate parts of the system prompt')
							);
							console.log(chalk.gray('💡 Different provider types: static, dynamic, file-based'));
							console.log(
								chalk.gray('💡 Use add-dynamic/add-file to activate available providers.')
							);
							return true;
						}
						default:
							console.log(chalk.red(`❌ Unknown subcommand: ${subcommand}`));
							console.log(
								chalk.gray(
									'Available subcommands: list, add-dynamic, add-file, remove, update, enable, disable, help'
								)
							);
							return false;
					}
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Error in prompt-providers: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return false;
				}
			},
		});

		this.registerCommand({
			name: 'show-prompt',
			description: 'Display current system prompt with enhanced formatting',
			usage: '/show-prompt [--detailed] [--raw]',
			category: 'system',
			handler: async (args: string[], agent: MemAgent) => {
				try {
					const detailed = args.includes('--detailed');
					const raw = args.includes('--raw');
					const promptManager = agent.promptManager;
					let systemPrompt = '';
					let userPrompt = '';
					let builtInPrompt = '';
					// EnhancedPromptManager: use async generateSystemPrompt
					if (typeof (promptManager as any).generateSystemPrompt === 'function') {
						const result = await (promptManager as any).generateSystemPrompt();
						systemPrompt = result.content || '';
						// For enhanced mode, userPrompt and builtInPrompt are not separated, so leave blank or show N/A
						userPrompt = 'N/A';
						builtInPrompt = 'N/A';
					} else {
						throw new Error('No compatible prompt manager found');
					}

					if (raw) {
						console.log(systemPrompt);
						return true;
					}

					console.log(chalk.cyan('📝 Enhanced System Prompt Display'));
					console.log(chalk.cyan('==================================\n'));

					// Summary stats
					console.log(chalk.yellow('📊 **Prompt Statistics**'));
					console.log(`   - Total length: ${systemPrompt.length} characters`);
					console.log(`   - Line count: ${systemPrompt.split('\n').length} lines`);
					console.log(`   - User instruction: ${userPrompt}`);
					console.log(`   - Built-in instructions: ${builtInPrompt}`);
					console.log('');

					// Show preview or detailed view
					if (detailed) {
						console.log(chalk.yellow('📄 **Prompt Content (Full)**'));
						console.log(chalk.gray('╭─ System Prompt ────────────────────────────────────────╮'));
						const lines = systemPrompt.split('\n');
						for (const line of lines) {
							const truncated = line.length > 50 ? line.substring(0, 47) + '...' : line;
							console.log(chalk.gray('│ ') + truncated.padEnd(50) + chalk.gray(' │'));
						}
						console.log(chalk.gray('╰────────────────────────────────────────────────────────╯'));
						console.log('');
					} else {
						console.log(chalk.yellow('📄 **Prompt Preview** (first 500 chars)'));
						console.log(chalk.gray('╭─ System Prompt Preview ───────────────────────────────╮'));
						const preview = systemPrompt.substring(0, 500);
						const lines = preview.split('\n');
						for (const line of lines) {
							const truncated = line.length > 50 ? line.substring(0, 47) + '...' : line;
							console.log(chalk.gray('│ ') + truncated.padEnd(50) + chalk.gray(' │'));
						}
						if (systemPrompt.length > 500) {
							console.log(
								chalk.gray('│ ') + chalk.dim('... (truncated)').padEnd(50) + chalk.gray(' │')
							);
						}
						console.log(chalk.gray('╰────────────────────────────────────────────────────────╯'));
						console.log('');
					}

					console.log(chalk.gray('💡 Use --detailed for full breakdown'));
					console.log(chalk.gray('💡 Use --raw for raw text output'));

					return true;
				} catch (error) {
					console.log(
						chalk.red(
							`❌ Error displaying prompt: ${error instanceof Error ? error.message : String(error)}`
						)
					);
					return false;
				}
			},
		});
	}

	/**
	 * Helper function to format session information
	 */
	private formatSessionInfo(sessionId: string, metadata?: any, isCurrent: boolean = false): string {
		const prefix = isCurrent ? chalk.green('→') : ' ';
		const name = isCurrent ? chalk.green.bold(sessionId) : chalk.cyan(sessionId);

		let info = `${prefix} ${name}`;

		if (metadata) {
			const messages = metadata.messageCount || 0;
			let activity = 'Never';

			if (metadata.lastActivity) {
				activity = new Date(metadata.lastActivity).toLocaleString();
			}

			info += chalk.dim(` (${messages} messages, last: ${activity})`);

			if (isCurrent) {
				info += chalk.yellow(' [ACTIVE]');
			}
		}

		return info;
	}

	/**
	 * Session list subcommand handler
	 */
	private async sessionListHandler(args: string[], agent: MemAgent): Promise<boolean> {
		try {
			const sessionIds = await agent.listSessions();
			const currentSessionId = agent.getCurrentSessionId();

			console.log(chalk.cyan('📋 Active Sessions:'));
			console.log('');

			if (sessionIds.length === 0) {
				console.log(chalk.gray('  No sessions found.'));
				console.log(chalk.gray('  💡 Use /session new to create a session'));
				return true;
			}

			for (const sessionId of sessionIds.sort()) {
				const metadata = await agent.getSessionMetadata(sessionId);
				const isCurrent = sessionId === currentSessionId;
				console.log(`  ${this.formatSessionInfo(sessionId, metadata, isCurrent)}`);
			}

			console.log('');
			console.log(chalk.gray(`Total: ${sessionIds.length} sessions`));
			console.log(chalk.gray('💡 Use /session switch <id> to change sessions'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session new subcommand handler
	 */
	private async sessionNewHandler(args: string[], agent: MemAgent): Promise<boolean> {
		try {
			const sessionId = args.length > 0 ? args[0] : undefined;

			const session = await agent.createSession(sessionId);
			console.log(chalk.green(`✅ Created new session: ${session.id}`));

			// Auto-switch to new session
			await agent.loadSession(session.id);

			// Wait for background initialization to complete based on log level
			// This prevents the CLI prompt from appearing before services are ready
			const currentLogLevel = process.env.CIPHER_LOG_LEVEL || 'info';
			const isDebugLevel = ['debug', 'trace'].includes(currentLogLevel);

			if (isDebugLevel) {
				// At debug level, wait longer for background operations to complete
				// This ensures all initialization logs are written before showing the prompt
				await new Promise(resolve => setTimeout(resolve, 500));
			} else {
				// At info level or higher, wait a shorter time
				await new Promise(resolve => setTimeout(resolve, 200));
			}

			console.log(chalk.blue('🔄 Switched to new session'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to create session: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session switch subcommand handler
	 */
	private async sessionSwitchHandler(args: string[], agent: MemAgent): Promise<boolean> {
		try {
			if (args.length === 0) {
				console.log(chalk.red('❌ Session ID required'));
				console.log(chalk.gray('Usage: /session switch <id>'));
				return false;
			}

			const sessionId = args[0];
			if (!sessionId) {
				console.log(chalk.red('❌ Session ID cannot be empty'));
				return false;
			}

			// Load the session and wait for it to complete
			await agent.loadSession(sessionId);

			// Wait for background initialization to complete based on log level
			// This prevents the CLI prompt from appearing before services are ready
			const currentLogLevel = process.env.CIPHER_LOG_LEVEL || 'info';
			const isDebugLevel = ['debug', 'trace'].includes(currentLogLevel);

			if (isDebugLevel) {
				// At debug level, wait longer for background operations to complete
				// This ensures all initialization logs are written before showing the prompt
				await new Promise(resolve => setTimeout(resolve, 500));
			} else {
				// At info level or higher, wait a shorter time
				await new Promise(resolve => setTimeout(resolve, 200));
			}

			const metadata = await agent.getSessionMetadata(sessionId);
			console.log(chalk.green(`✅ Switched to session: ${sessionId}`));

			if (metadata && metadata.messageCount && metadata.messageCount > 0) {
				console.log(chalk.gray(`   ${metadata.messageCount} messages in history`));
			} else {
				console.log(chalk.gray('   New conversation - no previous messages'));
			}

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to switch session: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session current subcommand handler
	 */
	private async sessionCurrentHandler(args: string[], agent: MemAgent): Promise<boolean> {
		try {
			const currentSessionId = agent.getCurrentSessionId();
			if (!currentSessionId) {
				console.log(chalk.yellow('⚠️ No current session'));
				return true;
			}

			const metadata = await agent.getSessionMetadata(currentSessionId);

			console.log(chalk.cyan('📍 Current Session:'));
			console.log('');
			console.log(`  ${this.formatSessionInfo(currentSessionId, metadata, true)}`);
			console.log('');

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to get current session: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session delete subcommand handler
	 */
	private async sessionDeleteHandler(args: string[], agent: MemAgent): Promise<boolean> {
		try {
			if (args.length === 0) {
				console.log(chalk.red('❌ Session ID required'));
				console.log(chalk.gray('Usage: /session delete <id>'));
				return false;
			}

			const sessionId = args[0];
			if (!sessionId) {
				console.log(chalk.red('❌ Session ID cannot be empty'));
				return false;
			}

			const currentSessionId = agent.getCurrentSessionId();

			if (sessionId === currentSessionId) {
				console.log(chalk.yellow('⚠️  Cannot delete the currently active session'));
				console.log(chalk.gray('   Switch to another session first, then delete this one'));
				return false;
			}

			await agent.removeSession(sessionId);
			console.log(chalk.green(`✅ Deleted session: ${sessionId}`));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to delete session: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session save subcommand handler
	 */
	private async sessionSaveHandler(_args: string[], agent: MemAgent): Promise<boolean> {
		try {
			console.log(chalk.cyan('💾 Saving all sessions to persistent storage...'));

			const result = await agent.saveAllSessions();

			console.log('');
			if (result.saved > 0) {
				console.log(chalk.green(`✅ Successfully saved ${result.saved} session(s)`));
			}

			if (result.failed > 0) {
				console.log(chalk.yellow(`⚠️  Failed to save ${result.failed} session(s)`));
			}

			if (result.total === 0) {
				console.log(chalk.gray('📭 No active sessions to save'));
			}

			console.log(chalk.gray(`📊 Total: ${result.total} sessions processed`));
			console.log('');

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to save sessions: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session load subcommand handler
	 */
	private async sessionLoadHandler(_args: string[], agent: MemAgent): Promise<boolean> {
		try {
			console.log(chalk.cyan('📂 Loading sessions from persistent storage...'));

			const result = await agent.loadAllSessions();

			console.log('');
			if (result.restored > 0) {
				console.log(chalk.green(`✅ Successfully restored ${result.restored} session(s)`));
			}

			if (result.failed > 0) {
				console.log(chalk.yellow(`⚠️  Failed to restore ${result.failed} session(s)`));
			}

			if (result.total === 0) {
				console.log(chalk.gray('📭 No sessions found in storage'));
			}

			console.log(chalk.gray(`📊 Total: ${result.total} sessions found in storage`));
			console.log('');
			console.log(chalk.gray('💡 Use /session list to see all active sessions'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Session help subcommand handler
	 */
	private async sessionHelpHandler(_args: string[], _agent: MemAgent): Promise<boolean> {
		console.log(chalk.cyan('\n📋 Session Management Commands:\n'));

		console.log(chalk.yellow('Available subcommands:'));

		const subcommands = [
			'/session list - List all sessions with status and activity',
			'/session new [name] - Create new session (optional custom name)',
			'/session switch <id> - Switch to different session',
			'/session current - Show current session info',
			'/session delete <id> - Delete session (cannot delete active)',
			'/session save - Manually save all sessions to persistent storage',
			'/session load - Manually load sessions from persistent storage',
			'/session help - Show this help message',
		];

		subcommands.forEach(cmd => console.log(`  ${cmd}`));

		console.log('\n' + chalk.gray('�� Sessions allow you to maintain separate conversations'));
		console.log(chalk.gray('💡 Use /session switch <id> to change sessions'));
		console.log(chalk.gray('💡 Session names can be custom or auto-generated UUIDs'));
		console.log('');

		return true;
	}

	/**
	 * Prompt providers list subcommand handler
	 */
	private async promptProvidersListHandler(_args: string[], agent: MemAgent): Promise<boolean> {
		try {
			console.log(chalk.cyan('📋 System Prompt Providers'));
			console.log(chalk.cyan('==========================\n'));

			const promptManager = agent.promptManager;

			// For enhanced prompt manager, show actual providers
			console.log(chalk.yellow('Enhanced Prompt System Active'));
			console.log('');

			const providers = promptManager.listProviders();
			if (providers.length === 0) {
				console.log(chalk.gray('  No providers configured.'));
				console.log(
					chalk.gray('  💡 Use /prompt-providers add-dynamic, add-file, or update existing ones.')
				);
			} else {
				for (const p of providers) {
					console.log(`${p.enabled ? chalk.green('🟢') : chalk.red('🔴')} ${p.id} (${p.type})`);
				}
			}
			console.log('');

			console.log(chalk.gray('💡 This is an Enhanced Prompt Manager system'));
			console.log(
				chalk.gray('💡 You can manage providers like user-instruction, built-in-instructions, etc.')
			);
			console.log(chalk.gray('💡 Use /prompt-providers enable/disable to manage provider status.'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to list providers: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Prompt providers enable subcommand handler
	 */
	private async promptProvidersEnableHandler(args: string[], _agent: MemAgent): Promise<boolean> {
		try {
			if (args.length === 0) {
				console.log(chalk.red('❌ Provider name required'));
				console.log(chalk.gray('Usage: /prompt-providers enable <provider-name>'));
				return false;
			}

			// const providerName = args[0];

			console.log(chalk.yellow('⚠️ Enhanced Prompt System Active'));
			console.log('');
			console.log('The current prompt system uses an Enhanced PromptManager that supports');
			console.log('individual provider management.');
			console.log('');
			console.log('Available providers:');
			console.log('  - user-instruction (static, priority: 100)');
			console.log('  - built-in-instructions (static, priority: 0)');
			console.log('  - dynamic-generators (dynamic, priority: 50)');
			console.log('  - file-based-providers (file-based, priority: 40)');
			console.log('');
			console.log(chalk.gray('💡 Use /prompt-providers disable <name> to disable a provider.'));
			console.log(chalk.gray('💡 Providers can be re-enabled by re-adding them.'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to enable provider: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Prompt providers disable subcommand handler
	 */
	private async promptProvidersDisableHandler(args: string[], _agent: MemAgent): Promise<boolean> {
		try {
			if (args.length === 0) {
				console.log(chalk.red('❌ Provider name required'));
				console.log(chalk.gray('Usage: /prompt-providers disable <provider-name>'));
				return false;
			}

			// const providerName = args[0];

			console.log(chalk.yellow('⚠️ Enhanced Prompt System Active'));
			console.log('');
			console.log('The current prompt system uses an Enhanced PromptManager that supports');
			console.log('individual provider management.');
			console.log('');
			console.log('In enhanced mode:');
			console.log('  - You can disable a provider by removing it or setting enabled: false.');
			console.log('  - Providers can be re-enabled by re-adding them or setting enabled: true.');
			console.log('');
			console.log(chalk.gray('💡 Use /prompt-providers enable <name> to re-enable a provider.'));
			console.log(chalk.gray('💡 Providers can be re-enabled by re-adding them.'));

			return true;
		} catch (error) {
			console.log(
				chalk.red(
					`❌ Failed to disable provider: ${error instanceof Error ? error.message : String(error)}`
				)
			);
			return false;
		}
	}

	/**
	 * Prompt providers help subcommand handler
	 */
	private async promptProvidersHelpHandler(_args: string[], _agent: MemAgent): Promise<boolean> {
		console.log(chalk.cyan('\n📋 Prompt Provider Management Commands:\n'));

		console.log(chalk.yellow('Available subcommands:'));

		const subcommands = [
			'/prompt-providers list - List all available prompt providers',
			'/prompt-providers enable <name> - Enable a specific provider',
			'/prompt-providers disable <name> - Disable a specific provider',
			'/prompt-providers help - Show this help message',
		];

		subcommands.forEach(cmd => console.log(`  ${cmd}`));

		console.log(
			'\n' + chalk.gray('💡 Providers are components that generate parts of the system prompt')
		);
		console.log(chalk.gray('💡 Different provider types: static, dynamic, file-based'));
		console.log(
			chalk.gray('💡 Current system uses Enhanced Prompt Manager for provider management')
		);
		console.log(
			chalk.gray('💡 You can manage providers like user-instruction, built-in-instructions, etc.')
		);
		console.log('');

		return true;
	}
}

/**
 * Global command parser instance
 */
export const commandParser = new CommandParser();
