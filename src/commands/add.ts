import {input, search, select} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'

import type {Bullet} from '../core/domain/entities/bullet.js'
import type {IPlaybookService} from '../core/interfaces/i-playbook-service.js'
import type {IPlaybookStore} from '../core/interfaces/i-playbook-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {Playbook} from '../core/domain/entities/playbook.js'
import {FilePlaybookStore} from '../infra/ace/file-playbook-store.js'
import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

// Type Definitions
type UserAction = 'add' | 'update'

interface SectionPromptOptions {
  readonly existingSections: readonly string[]
  readonly suggestedSections: readonly string[]
}

interface ContentPromptContext {
  readonly action: UserAction
  readonly existingContent?: string
  readonly section: string
}

// Constants
const SUGGESTED_SECTIONS = [
  'Common Errors',
  'Best Practices',
  'Strategies',
  'Lessons Learned',
  'Architecture',
  'Testing',
]

const validateContent = (content: string): boolean => content.trim().length > 0

export default class Add extends Command {
  public static description = 'Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --interactive',
    '<%= config.bin %> <%= command.id %> -i',
    '<%= config.bin %> <%= command.id %> --section "Common Errors" --content "Authentication fails when token expires"',
    '<%= config.bin %> <%= command.id %> --section "Common Errors" --bullet-id "common-00001" --content "Updated: Auth fails when token expires"',
    '<%= config.bin %> <%= command.id %> -s "Best Practices" -c "Always validate user input before processing"',
  ]
  public static flags = {
    'bullet-id': Flags.string({
      char: 'b',
      description: 'Bullet ID to update (if not provided, a new bullet will be created)',
      required: false,
    }),
    content: Flags.string({
      char: 'c',
      description: 'Content of the bullet',
      required: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      default: false,
      description: 'Run in interactive mode',
    }),
    section: Flags.string({
      char: 's',
      description: 'Section name for the bullet',
      required: false,
    }),
  }

  protected createServices(): {
    playbookService: IPlaybookService
    playbookStore: IPlaybookStore
    trackingService: ITrackingService
  } {
    return {
      playbookService: new FilePlaybookService(),
      playbookStore: new FilePlaybookStore(),
      trackingService: new MixpanelTrackingService(new KeychainTokenStore()),
    }
  }

  /**
   * Prompt user to choose between adding a new bullet or updating an existing one
   */
  protected async promptForAction(): Promise<UserAction> {
    const action = await select<UserAction>({
      choices: [
        {name: 'Add a new bullet', value: 'add'},
        {name: 'Update an existing bullet', value: 'update'},
      ],
      message: 'What would you like to do?',
    })
    return action
  }

  /**
   * Prompt user to select a bullet to update
   */
  protected async promptForBullet(bullets: Bullet[]): Promise<string> {
    const displayBullets = bullets.map((bullet) => ({
      contentPreview: bullet.content.length > 60 ? `${bullet.content.slice(0, 60)}...` : bullet.content,
      id: bullet.id,
      section: bullet.section,
      tags: bullet.metadata.tags,
      timestamp: new Date(bullet.metadata.timestamp).toLocaleDateString(),
    }))

    const bulletId = await search({
      message: 'Select a bullet to update:',
      async source(input) {
        const filtered = input
          ? displayBullets.filter(
              (b) =>
                b.section.toLowerCase().includes(input.toLowerCase()) ||
                b.contentPreview.toLowerCase().includes(input.toLowerCase()) ||
                b.id.toLowerCase().includes(input.toLowerCase()),
            )
          : displayBullets

        return filtered.map((b) => ({
          description: `Tags: ${b.tags.join(', ')} | Date: ${b.timestamp}`,
          name: `[${b.id}] ${b.section}: ${b.contentPreview}`,
          value: b.id,
        }))
      },
    })

    return bulletId
  }

  /**
   * Prompt user to enter bullet content
   */
  protected async promptForContent(context: ContentPromptContext): Promise<string> {
    const message =
      context.action === 'update'
        ? `Enter new content for bullet in "${context.section}":`
        : `Enter content for new bullet in "${context.section}":`

    const content = await input({
      default: context.existingContent,
      message,
      validate(value) {
        if (!validateContent(value)) {
          return 'Content cannot be empty'
        }

        return true
      },
    })

    return content
  }

  /**
   * Prompt user to select or create a section name
   */
  protected async promptForSection(options: SectionPromptOptions): Promise<string> {
    const allSections = [...new Set([...options.existingSections, ...options.suggestedSections])]

    const section = await search({
      message: 'Select or type a section name:',
      async source(input) {
        if (!input) {
          return allSections.map((s) => ({name: s, value: s}))
        }

        const filtered = allSections.filter((s) => s.toLowerCase().includes(input.toLowerCase()))

        // Allow creating new section
        if (filtered.length === 0 || !filtered.includes(input)) {
          filtered.unshift(input)
        }

        return filtered.map((s) => ({name: s, value: s}))
      },
    })

    return section
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Add)

    return flags.interactive ? this.runInteractive() : this.runFlagBased(flags)
  }

  /**
   * Display success message after adding or updating a bullet
   */
  private displaySuccess(bullet: Bullet, action: UserAction): void {
    const actionText = action === 'update' ? 'Updated' : 'Added'
    this.log(`\n✓ ${actionText} bullet successfully!`)
    this.log(`  ID: ${bullet.id}`)
    this.log(`  Section: ${bullet.section}`)
    this.log(`  Content: ${bullet.content}`)

    if (bullet.metadata.tags.length > 0) {
      this.log(`  Tags: ${bullet.metadata.tags.join(', ')}`)
    }
  }

  /**
   * Run in flag-based mode (non-interactive)
   */
  private async runFlagBased(flags: {'bullet-id'?: string; content?: string; section?: string}): Promise<void> {
    const {playbookService, trackingService} = this.createServices()

    try {
      // Validate required flags
      if (!flags.section || !flags.content) {
        this.error('--section and --content are required in non-interactive mode')
      }

      // Warn if section is not a standard ACE section
      if (!SUGGESTED_SECTIONS.includes(flags.section)) {
        this.warn(
          `Section "${flags.section}" is not a standard ACE section.\n` +
            `  Suggested sections: ${SUGGESTED_SECTIONS.join(', ')}\n` +
            `  You can still proceed, but consider using a standard section for consistency.`,
        )
      }

      await trackingService.track('ace:add_bullet')

      const bullet = await playbookService.addOrUpdateBullet({
        bulletId: flags['bullet-id'],
        content: flags.content,
        section: flags.section,
      })

      this.displaySuccess(bullet, flags['bullet-id'] ? 'update' : 'add')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unexpected error occurred')
    }
  }

  /**
   * Run in interactive mode
   */
  private async runInteractive(): Promise<void> {
    const {playbookService, playbookStore, trackingService} = this.createServices()

    try {
      // Load existing playbook or create new one
      let playbook = await playbookStore.load()
      if (!playbook) {
        playbook = new Playbook()
      }

      const action = await this.promptForAction()

      const sectionOptions: SectionPromptOptions = {
        existingSections: playbook.getSections(),
        suggestedSections: SUGGESTED_SECTIONS,
      }
      const section = await this.promptForSection(sectionOptions)

      let bulletId: string | undefined
      let existingContent: string | undefined

      if (action === 'update') {
        const bullets = playbook.getBullets()
        if (bullets.length === 0) {
          this.warn('No bullets available to update. Creating new bullet instead.')
        } else {
          bulletId = await this.promptForBullet(bullets)
          const bullet = playbook.getBullet(bulletId)
          existingContent = bullet?.content
        }
      }

      const contentContext: ContentPromptContext = {
        action: bulletId ? 'update' : 'add',
        existingContent,
        section,
      }
      const content = await this.promptForContent(contentContext)

      const bullet = await playbookService.addOrUpdateBullet({
        bulletId,
        content,
        section,
      })

      await trackingService.track('ace:add_bullet', {
        interactive: true,
        section,
        update: Boolean(bulletId),
      })

      this.displaySuccess(bullet, bulletId ? 'update' : 'add')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unexpected error occurred')
    }
  }
}
