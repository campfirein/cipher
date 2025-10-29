import {Command, Flags} from '@oclif/core'

import type {IPlaybookService} from '../core/interfaces/i-playbook-service.js'

import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'

export default class Add extends Command {
  public static description =
    'Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)'
  public static examples = [
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
      required: true,
    }),
    section: Flags.string({
      char: 's',
      description: 'Section name for the bullet',
      required: true,
    }),
  }
  // Suggested standard ACE section names to maintain consistency
  private static readonly SUGGESTED_SECTIONS = [
    'Common Errors',
    'Best Practices',
    'Strategies',
    'Lessons Learned',
    'Architecture',
    'Testing',
  ]

  protected createServices(): {
    playbookService: IPlaybookService
  } {
    return {
      playbookService: new FilePlaybookService(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Add)

    try {
      // Warn if section is not a standard ACE section
      if (!Add.SUGGESTED_SECTIONS.includes(flags.section)) {
        this.warn(
          `Section "${flags.section}" is not a standard ACE section.\n` +
            `  Suggested sections: ${Add.SUGGESTED_SECTIONS.join(', ')}\n` +
            `  You can still proceed, but consider using a standard section for consistency.`,
        )
      }

      const {playbookService} = this.createServices()

      // Call service method (throws on error)
      const bullet = await playbookService.addOrUpdateBullet({
        bulletId: flags['bullet-id'],
        content: flags.content,
        section: flags.section,
      })

      // Display success message
      const operationVerb = flags['bullet-id'] ? 'Updated' : 'Added'

      this.log(`✓ ${operationVerb} bullet successfully!`)
      this.log(`  ID: ${bullet.id}`)
      this.log(`  Section: ${bullet.section}`)
      this.log(`  Content: ${bullet.content}`)

      if (bullet.metadata.tags.length > 0) {
        this.log(`  Tags: ${bullet.metadata.tags.join(', ')}`)
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unexpected error occurred')
    }
  }
}
