import {Command, Flags} from '@oclif/core'
import {render} from 'ink'
import React from 'react'

import {QueueDashboard} from '../infra/cipher/ui/queue-dashboard.js'

export default class QueueDashboardCommand extends Command {
  public static description = 'Real-time dashboard for monitoring the execution queue'
public static examples = [
    '# Start dashboard with default settings',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Start dashboard with faster polling',
    '<%= config.bin %> <%= command.id %> --interval 200',
  ]
public static flags = {
    interval: Flags.integer({
      char: 'i',
      default: 500,
      description: 'Polling interval in milliseconds',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(QueueDashboardCommand)

    // Render Ink app (storage auto-detects .brv/blobs from cwd)
    const {waitUntilExit} = render(
      <QueueDashboard pollInterval={flags.interval} />
    )

    // Wait for app to exit
    await waitUntilExit()
  }
}
