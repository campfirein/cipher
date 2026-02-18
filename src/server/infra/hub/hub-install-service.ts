import axios, {isAxiosError} from 'axios'
import {join} from 'node:path'

import type {HubEntryDTO} from '../../../shared/transport/types/dto.js'
import type {Agent} from '../../core/domain/entities/agent.js'
import type {IHubInstallService} from '../../core/interfaces/hub/i-hub-install-service.js'
import type {IFileService} from '../../core/interfaces/services/i-file-service.js'
import type {SkillConnector} from '../connectors/skill/skill-connector.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'

export interface HubInstallServiceDeps {
  fileService: IFileService
  skillConnectorFactory: (projectRoot: string) => SkillConnector
}

export class HubInstallService implements IHubInstallService {
  private readonly fileService: IFileService
  private readonly skillConnectorFactory: (projectRoot: string) => SkillConnector

  constructor(deps: HubInstallServiceDeps) {
    this.fileService = deps.fileService
    this.skillConnectorFactory = deps.skillConnectorFactory
  }

  async install(
    entry: HubEntryDTO,
    projectPath: string,
    agent?: string,
  ): Promise<{installedFiles: string[]; message: string}> {
    return entry.type === 'agent-skill'
      ? this.installSkill(entry, projectPath, agent)
      : this.installBundle(entry, projectPath)
  }

  private async downloadAndWrite(files: Array<{name: string; url: string}>, targetDir: string): Promise<string[]> {
    const installedFiles: string[] = []

    await Promise.all(
      files.map(async (file) => {
        const content = await this.downloadFile(file.url)
        const filePath = join(targetDir, file.name)
        await this.fileService.write(content, filePath, 'overwrite')
        installedFiles.push(filePath)
      }),
    )

    return installedFiles
  }

  private async downloadFile(url: string): Promise<string> {
    try {
      const response = await axios.get<string>(url, {
        responseType: 'text',
        timeout: 15_000,
      })
      return response.data
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new Error(`Download timed out: ${url}`)
        }

        if (!error.response) {
          throw new Error(`Network error downloading: ${url}`)
        }

        throw new Error(`Failed to download file (HTTP ${error.response.status}): ${url}`)
      }

      throw new Error(`Failed to download: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private getContentFiles(entry: HubEntryDTO): Array<{name: string; url: string}> {
    return entry.file_tree.filter((file) => file.url !== entry.readme_url && file.url !== entry.manifest_url)
  }

  private async installBundle(
    entry: HubEntryDTO,
    projectPath: string,
  ): Promise<{installedFiles: string[]; message: string}> {
    const contextTreeDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)
    const contentFiles = this.getContentFiles(entry)

    if (contentFiles.length > 0) {
      const firstFilePath = join(contextTreeDir, contentFiles[0].name)
      if (await this.fileService.exists(firstFilePath)) {
        return {
          installedFiles: [],
          message: `${entry.name} is already installed in context tree`,
        }
      }
    }

    const installedFiles = await this.downloadAndWrite(contentFiles, contextTreeDir)

    return {
      installedFiles,
      message: `Installed ${entry.name} bundle to context tree.`,
    }
  }

  private async installSkill(
    entry: HubEntryDTO,
    projectPath: string,
    agent?: string,
  ): Promise<{installedFiles: string[]; message: string}> {
    if (!agent) {
      throw new Error('Agent is required to install a skill')
    }

    const skillConnector = this.skillConnectorFactory(projectPath)
    const contentFiles = this.getContentFiles(entry)

    const downloadedFiles = await Promise.all(
      contentFiles.map(async (file) => ({
        content: await this.downloadFile(file.url),
        name: file.name,
      })),
    )

    const result = await skillConnector.writeSkillFiles(agent as Agent, entry.id, downloadedFiles)

    if (result.alreadyInstalled) {
      return {
        installedFiles: [],
        message: `${entry.name} is already installed for ${agent}`,
      }
    }

    return {
      installedFiles: result.installedFiles,
      message: `Installed ${entry.name} skill for ${agent} at ${result.relativePath}/`,
    }
  }
}
