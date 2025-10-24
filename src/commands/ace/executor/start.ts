import {Args, Command, Flags} from '@oclif/core'

import {LoadPlaybookUseCase} from '../../../core/usecases/load-playbook-use-case.js'
import {FilePlaybookStore} from '../../../infra/ace/file-playbook-store.js'

export default class ExecutorStart extends Command {
  public static args = {
    task: Args.string({
      description: 'Task description for the executor',
      required: true,
    }),
  }
  public static description = 'Start an executor task and generate a prompt for the agent'
  public static examples = [
    '<%= config.bin %> <%= command.id %> "Add user authentication"',
    '<%= config.bin %> <%= command.id %> "Fix validation bug" --with-playbook',
    '<%= config.bin %> <%= command.id %> "Implement search functionality"',
  ]
  public static flags = {
    'with-playbook': Flags.boolean({
      char: 'p',
      default: false,
      description: 'Include playbook knowledge in the prompt',
    }),
  }

  // Protected method for testability
  protected generatePrompt(task: string, withPlaybook: boolean, playbookPrompt?: string): string {
    const playbookSection = withPlaybook && playbookPrompt ? `
## Playbook Knowledge
${playbookPrompt}

## Instructions
- Review the playbook knowledge above
- Complete the task description
- Reference relevant bullets by their IDs when applicable
- Document your reasoning and approach
- Use the playbook knowledge to inform your implementation decisions
` : `
## Instructions
- Complete the task description
- Document your reasoning and approach
- If you reference any playbook knowledge, note the bullet IDs
`

    return `# Executor Task

## Task Description
${task}
${playbookSection}
## Output Requirements
After completing the task, you MUST provide your output in the following JSON format:

\`\`\`json
{
  "reasoning": "Your detailed reasoning and approach for completing the task",
  "finalAnswer": "The final solution/answer to the task",
  "bulletIds": ["bullet-id-1", "bullet-id-2"],
  "toolUsage": ["tool1", "tool2", "command3"]
}
\`\`\`

**Field Descriptions:**
- \`reasoning\`: Explain your thought process, decisions, and approach (required)
- \`finalAnswer\`: The complete solution or answer to the task (required)
- \`bulletIds\`: Array of playbook bullet IDs you referenced (empty array if none)
- \`toolUsage\`: Array of tools/commands/technologies used (e.g., ["git", "npm", "TypeScript"])

**IMPORTANT**: Your response must be valid JSON matching this structure exactly.

## After Completing the Task

Once you have finished the task and generated the output JSON, you MUST save it by running:

\`\`\`bash
br ace executor save '<reasoning>' '<finalAnswer>' --bullet-ids 'id1,id2' --tool-usage 'tool1,tool2'
\`\`\`

Replace the placeholders with your actual output values:
- \`<reasoning>\`: Your reasoning text (use quotes if it contains spaces)
- \`<finalAnswer>\`: Your final answer text (use quotes if it contains spaces)
- \`--bullet-ids\`: Comma-separated list of bullet IDs you referenced
- \`--tool-usage\`: Comma-separated list of tools/technologies used

Example:
\`\`\`bash
br ace executor save 'Used TypeScript strict mode and followed existing patterns' 'Successfully implemented user authentication with JWT tokens' --bullet-ids 'bullet-123,bullet-456' --tool-usage 'TypeScript,JWT,bcrypt'
\`\`\`
`
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ExecutorStart)

    try {
      let playbookPrompt: string | undefined

      // Load playbook only if requested
      if (flags['with-playbook']) {
        const playbookStore = new FilePlaybookStore()
        const loadUseCase = new LoadPlaybookUseCase(playbookStore)

        const result = await loadUseCase.execute()

        if (!result.success) {
          this.error(result.error || 'Failed to load playbook')
        }

        playbookPrompt = result.playbookPrompt!
      }

      // Generate prompt
      const executorPrompt = this.generatePrompt(args.task, flags['with-playbook'], playbookPrompt)

      // Display summary
      this.log('✓ Executor task started')
      this.log(`  Task: ${args.task}`)
      if (flags['with-playbook'] && playbookPrompt) {
        this.log('  Playbook: included')
      } else {
        this.log('  Playbook: not included')
      }

      this.log('')

      // Display full prompt to stdout (for agent consumption)
      this.log(executorPrompt)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to start executor task')
    }
  }
}
