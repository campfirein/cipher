import {select} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'

import {type ProviderConfigResponse, TransportStateEventNames} from '../../server/core/domain/transport/schemas.js'
import {
  type ConnectorDetectAgentsResponse,
  type ConnectorDetectedAgent,
  ConnectorEvents,
  type ConnectorInstallBundleRequest,
  type ConnectorInstallBundleResponse,
} from '../../shared/transport/events/connector-events.js'
import {type Agent, AGENT_VALUES, isAgent} from '../../shared/types/agent.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {isPromptCancelled} from '../lib/prompt-utils.js'

export default class Connect extends Command {
  public static args = {
    agent: Args.string({
      description: 'Agent to connect (e.g. "Claude Code"). Omit to auto-detect.',
      options: [...AGENT_VALUES],
      required: false,
    }),
  }
  public static description = `Connect ByteRover memory to your coding agent.

Installs the full integration bundle (sub-agent, recall skill, onboarding skill,
MCP server, project rule directive) for the detected coding agent. Auto-detects
the agent from project markers (.claude/, .cursor/, etc.) via the daemon. Pass
an agent name explicitly to skip detection.`
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> "Claude Code"']
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected getDaemonOptions(): DaemonClientOptions {
    return {projectPath: process.cwd()}
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Connect)
    const format = flags.format as 'json' | 'text'

    let agent: Agent | undefined = isAgent(args.agent) ? args.agent : undefined
    if (!agent) {
      agent = await this.detectAndPickAgent(format)
      if (!agent) return
    }

    const providerReady = await this.ensureProviderConnected(format)
    if (!providerReady) return

    let response: ConnectorInstallBundleResponse
    try {
      response = await withDaemonRetry<ConnectorInstallBundleResponse>(
        async (client) =>
          client.requestWithAck<ConnectorInstallBundleResponse>(ConnectorEvents.INSTALL_BUNDLE, {
            agentId: agent,
          } satisfies ConnectorInstallBundleRequest),
        this.getDaemonOptions(),
      )
    } catch (error) {
      this.respondError(format, formatConnectionError(error))
      return
    }

    if (!response.success) {
      this.respondError(format, response.message)
      return
    }

    if (format === 'json') {
      writeJsonResponse({
        command: 'connect',
        data: {
          agent: response.agent,
          installed: response.installed,
          projectPath: response.projectPath,
          skipped: response.skipped,
        },
        success: true,
      })
      return
    }

    this.log(`Connected ${response.agent} in ${response.projectPath}`)
    this.log('')
    for (const step of response.installed) {
      this.log(`  ✓ ${step.artifact}  ${step.path}`)
    }

    for (const step of response.skipped) {
      this.log(`  ↷ ${step.artifact} (skipped: ${step.reason})`)
    }

    const onboardingInstalled = response.installed.some((step) => step.artifact === 'onboarding-skill')
    if (onboardingInstalled) {
      this.log('')
      this.log(`Next: open ${agent} in this repo and try:`)
      this.log('  "I just installed byterover, what now?"')
    }
  }

  private async detectAndPickAgent(format: 'json' | 'text'): Promise<Agent | undefined> {
    let detection: ConnectorDetectAgentsResponse
    try {
      detection = await withDaemonRetry<ConnectorDetectAgentsResponse>(
        async (client) => client.requestWithAck<ConnectorDetectAgentsResponse>(ConnectorEvents.DETECT_AGENTS, {}),
        this.getDaemonOptions(),
      )
    } catch (error) {
      this.respondError(format, formatConnectionError(error))
      return undefined
    }

    return this.pickAgent(detection.detected, format)
  }

  private async ensureProviderConnected(format: 'json' | 'text'): Promise<boolean> {
    const isConnected = async (): Promise<boolean> => {
      const providerConfig = await withDaemonRetry<ProviderConfigResponse>(
        async (client) => client.requestWithAck<ProviderConfigResponse>(TransportStateEventNames.GET_PROVIDER_CONFIG),
        this.getDaemonOptions(),
      )
      return Boolean(providerConfig.activeProvider) && !providerConfig.providerKeyMissing
    }

    try {
      if (await isConnected()) return true
    } catch (error) {
      this.respondError(format, formatConnectionError(error))
      return false
    }

    if (format === 'json') {
      this.respondError(
        format,
        'No LLM provider connected. Run `brv providers connect` first, then re-run `brv connect`.',
      )
      return false
    }

    this.log('No LLM provider connected yet — launching `brv providers connect`...\n')
    try {
      await this.config.runCommand('providers:connect')
    } catch {
      this.respondError(format, 'Provider connect failed. Run `brv providers connect` manually, then re-run `brv connect`.')
      return false
    }

    try {
      if (await isConnected()) return true
    } catch (error) {
      this.respondError(format, formatConnectionError(error))
      return false
    }

    this.respondError(format, 'No provider was selected. Run `brv providers connect` manually when ready.')
    return false
  }

  private async pickAgent(detected: ConnectorDetectedAgent[], format: 'json' | 'text'): Promise<Agent | undefined> {
    if (format === 'json') {
      if (detected.length === 1) return detected[0].agent
      if (detected.length === 0) {
        this.respondError(format, 'No coding agent detected. Pass an agent name explicitly.')
        return undefined
      }

      this.respondError(
        format,
        `Multiple agents detected (${detected.map((d) => d.agent).join(', ')}). Pass an agent name explicitly.`,
      )
      return undefined
    }

    if (detected.length === 0) return this.promptFullAgentList('No agent detected. Pick which to connect:')

    if (detected.length === 1) {
      const single = detected[0]
      const choice = await this.promptDetectedOrOther(
        [single],
        `Detected ${single.agent} (via ${single.evidence}). Connect this one?`,
      )
      return choice
    }

    return this.promptDetectedOrOther(detected, 'Multiple agents detected. Pick which to connect:')
  }

  private async promptDetectedOrOther(
    detected: ConnectorDetectedAgent[],
    message: string,
  ): Promise<Agent | undefined> {
    const otherSentinel = '__other__'
    const choices = [
      ...detected.map((d) => ({description: `Detected via ${d.evidence}`, name: d.agent, value: d.agent as string})),
      {description: 'Pick from the full list of supported agents', name: 'Other…', value: otherSentinel},
    ]

    let picked: string
    try {
      picked = await select({choices, loop: false, message})
    } catch (error) {
      if (!isPromptCancelled(error)) throw error
      return undefined
    }

    if (picked === otherSentinel) return this.promptFullAgentList('Pick an agent:')
    return isAgent(picked) ? picked : undefined
  }

  private async promptFullAgentList(message: string): Promise<Agent | undefined> {
    try {
      return await select({
        choices: AGENT_VALUES.map((a) => ({name: a, value: a})),
        loop: false,
        message,
      })
    } catch (error) {
      if (!isPromptCancelled(error)) throw error
      return undefined
    }
  }

  private respondError(format: 'json' | 'text', message: string): void {
    if (format === 'json') {
      writeJsonResponse({command: 'connect', data: {error: message}, success: false})
    } else {
      this.log(message)
    }
  }
}
