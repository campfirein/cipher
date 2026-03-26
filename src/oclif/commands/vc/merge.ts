import {Args, Command, Flags} from '@oclif/core'
import {execSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type IVcMergeResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcMerge extends Command {
  public static args = {
    branch: Args.string({description: 'Branch to merge into the current branch', required: false}),
  }
  public static description = 'Merge a branch into the current branch'
  public static examples = [
    '<%= config.bin %> <%= command.id %> feature/my-branch',
    '<%= config.bin %> <%= command.id %> --abort',
    '<%= config.bin %> <%= command.id %> --continue',
    '<%= config.bin %> <%= command.id %> -m "Custom merge message" feature/my-branch',
  ]
  public static flags = {
    abort: Flags.boolean({
      default: false,
      description: 'Abort the current merge',
      exclusive: ['continue'],
    }),
    'allow-unrelated-histories': Flags.boolean({
      default: false,
      description: 'Allow merging unrelated histories',
    }),
    continue: Flags.boolean({
      default: false,
      description: 'Continue the current merge after resolving conflicts',
      exclusive: ['abort'],
    }),
    message: Flags.string({
      char: 'm',
      description: 'Merge commit message',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcMerge)

    if (flags.abort) {
      return this.handleAbort()
    }

    if (flags.continue) {
      return this.handleContinue(flags.message)
    }

    if (!args.branch) {
      this.error('Usage: brv vc merge <branch> | --abort | --continue')
    }

    return this.handleMerge(args.branch, flags.message, flags['allow-unrelated-histories'])
  }

  private async handleAbort(): Promise<void> {
    try {
      await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcMergeResponse>(VcEvents.MERGE, {action: 'abort'}),
      )
      // Native git produces no output on successful abort
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private async handleContinue(message?: string): Promise<void> {
    try {
      if (message) {
        // Message provided via -m — commit directly
        await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcMergeResponse>(VcEvents.MERGE, {action: 'continue', message}),
        )
        return
      }

      // No message — get default from server, open editor
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcMergeResponse>(VcEvents.MERGE, {action: 'continue'}),
      )

      const editedMessage = this.openEditor(result.defaultMessage ?? 'Merge commit')
      if (!editedMessage) {
        this.error('Aborting commit due to empty commit message.')
      }

      await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcMergeResponse>(VcEvents.MERGE, {action: 'continue', message: editedMessage}),
      )
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private async handleMerge(branch: string, message?: string, allowUnrelatedHistories?: boolean): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcMergeResponse>(VcEvents.MERGE, {
          action: 'merge',
          allowUnrelatedHistories,
          branch,
          message,
        }),
      )

      if (result.conflicts && result.conflicts.length > 0) {
        for (const conflict of result.conflicts) {
          this.log(`CONFLICT (${conflict.type}): ${conflict.path}`)
        }

        this.log('Automatic merge failed; fix conflicts and then commit the result.')
      } else {
        this.log(`Merged branch '${branch}'.`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private openEditor(defaultMessage: string): string {
    const editor = process.env.GIT_EDITOR ?? process.env.EDITOR ?? 'vim'
    const tmpDir = mkdtempSync(join(tmpdir(), 'brv-merge-'))
    const tmpFile = join(tmpDir, 'MERGE_MSG')

    writeFileSync(tmpFile, defaultMessage)

    try {
      execSync(`${editor} "${tmpFile}"`, {stdio: 'inherit'})
      const content = readFileSync(tmpFile, 'utf8')
      // Strip comment lines and trim
      const cleaned = content
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim()
      return cleaned
    } finally {
      try {
        rmSync(tmpDir, {force: true, recursive: true})
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
