import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import type {ProjectLocationDTO} from '../../shared/transport/types/dto.js'

import {LocationsEvents, type LocationsGetResponse} from '../../shared/transport/events/locations-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Locations extends Command {
  public static description = 'List all registered projects and their context tree status'
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --format json']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchLocations(options?: DaemonClientOptions): Promise<ProjectLocationDTO[]> {
    return withDaemonRetry<ProjectLocationDTO[]>(async (client) => {
      const response = await client.requestWithAck<LocationsGetResponse>(LocationsEvents.GET)
      return response.locations
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Locations)
    const isJson = flags.format === 'json'

    try {
      const locations = await this.fetchLocations()

      if (isJson) {
        writeJsonResponse({command: 'locations', data: {locations}, success: true})
      } else {
        this.formatTextOutput(locations)
      }
    } catch (error) {
      if (isJson) {
        writeJsonResponse({command: 'locations', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private formatLocationEntry(loc: ProjectLocationDTO): void {
    const label = loc.isCurrent ? '  ' + chalk.green('[current]') : loc.isActive ? '  ' + chalk.yellow('[active]') : ''
    const path = loc.isCurrent || loc.isActive ? chalk.bold(loc.projectPath) : loc.projectPath
    this.log(`  ${path}${label}`)
    if (loc.isInitialized) {
      const domainLabel = loc.domainCount === 1 ? 'domain' : 'domains'
      const fileLabel = loc.fileCount === 1 ? 'file' : 'files'
      this.log(
        chalk.dim(`  └─ .brv/context-tree/    ${loc.domainCount} ${domainLabel} · ${loc.fileCount} ${fileLabel}`),
      )
    } else {
      this.log(chalk.dim('  └─ .brv/context-tree/    (not initialized)'))
    }
  }

  private formatTextOutput(locations: ProjectLocationDTO[]): void {
    if (locations.length > 0) {
      this.log(`Registered Projects — ${locations.length} found`)
      this.log('──────────────────────────────────────────')
      for (const loc of locations) {
        this.formatLocationEntry(loc)
        this.log('')
      }
    } else {
      this.log('Registered Projects — none found')
    }
  }
}
