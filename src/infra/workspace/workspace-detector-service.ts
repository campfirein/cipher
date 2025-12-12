import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {Agent} from '../../core/domain/entities/agent.js'
import type {IWorkspaceDetectorService, WorkspaceInfo} from '../../core/interfaces/i-workspace-detector-service.js'

/**
 * Service to detect IDE workspaces that contain the current working directory
 * Supports: VS Code (Github Copilot), Cursor, Claude, and Codex
 */
export class WorkspaceDetectorService implements IWorkspaceDetectorService {
  private readonly claudeUserPath: string
  private readonly codexUserPath: string
  private readonly cursorUserPath: string
  private readonly cwd: string
  private readonly vscodeUserPath: string

  public constructor(cwd: string = process.cwd()) {
    this.cwd = cwd
    this.vscodeUserPath = join(homedir(), 'Library/Application Support/Code/User/workspaceStorage')
    this.cursorUserPath = join(homedir(), 'Library/Application Support/Cursor/User/workspaceStorage')
    this.claudeUserPath = join(homedir(), '.claude/projects')
    this.codexUserPath = join(homedir(), '.codex/sessions')
  }

  /**
   * Detect workspaces for the given IDE
   *
   * Supports: Github Copilot (VSCode), Cursor, Claude Code, Codex
   *
   * chatLogPath:
   *   - For Cursor/VSCode: Path to workspace storage folder if workspace.json matches cwd
   *   - For Claude Code: Path to claude project folder matching cwd (with special naming pattern)
   *   - For Codex: Direct path to codex sessions folder
   */
  public detectWorkspaces(agent: Agent): WorkspaceInfo {
    const chatLogPath: string = ''

    switch (agent) {
      case 'Claude Code': {
        return this.detectClaudeWorkspaces(chatLogPath)
      }

      case 'Codex': {
        return this.detectCodexWorkspaces(chatLogPath)
      }

      case 'Cursor': {
        return this.detectCursorWorkspaces(chatLogPath)
      }

      case 'Github Copilot': {
        return this.detectVSCodeWorkspaces(chatLogPath)
      }

      default: {
        return { chatLogPath, cwd: this.cwd }
      }
    }
  }

  /**
   * Convert current working directory to Claude Code folder name format
   * Example: /Users/datpham/dpmemories/byterover-cli -> -Users-datpham-dpmemories-byterover-cli
   */
  private cwdToClaudeFolderName(cwd: string): string {
    // Remove leading slash and replace all slashes with dashes, then prepend dash
    return '-' + cwd.slice(1).replaceAll('/', '-')
  }

  /**
   * Detect Claude Code workspaces
   * Claude Code stores projects in ~/.claude/projects with folder names like "-Users-datpham-dpmemories-byterover-cli"
   * These folder names are derived from the project path with slashes replaced by dashes
   */
  private detectClaudeWorkspaces(chatLogPath: string): WorkspaceInfo {
    try {
      if (!existsSync(this.claudeUserPath)) {
        return { chatLogPath, cwd: this.cwd }
      }

      // Convert cwd to Claude folder name format: /Users/datpham/dpmemories/byterover-cli -> -Users-datpham-dpmemories-byterover-cli
      const claudeFolderName = this.cwdToClaudeFolderName(this.cwd)

      const projectFolders = readdirSync(this.claudeUserPath)

      for (const folderName of projectFolders) {
        const folderPath = join(this.claudeUserPath, folderName)

        // Check if this folder matches the current working directory
        if (folderName === claudeFolderName) {
          chatLogPath = folderPath
          break
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return { chatLogPath, cwd: this.cwd }
  }

  /**
   * Detect Codex workspaces
   * Codex uses a single sessions folder
   */
  private detectCodexWorkspaces(chatLogPath: string): WorkspaceInfo {
    try {
      if (existsSync(this.codexUserPath)) {
        chatLogPath = this.codexUserPath
      }
    } catch {
      // Ignore errors
    }

    return { chatLogPath, cwd: this.cwd }
  }

  /**
   * Detect Cursor workspaces
   */
  private detectCursorWorkspaces(chatLogPath: string): WorkspaceInfo {
    return this.detectWorkspacesByFile(this.cursorUserPath, chatLogPath)
  }

  /**
   * Detect VSCode workspaces (Github Copilot)
   */
  private detectVSCodeWorkspaces(chatLogPath: string): WorkspaceInfo {
    return this.detectWorkspacesByFile(this.vscodeUserPath, chatLogPath)
  }

  /**
   * Detect workspaces using workspace.json file (VSCode, Cursor)
   */
  private detectWorkspacesByFile(userPath: string, chatLogPath: string): WorkspaceInfo {
    try {
      if (!existsSync(userPath)) {
        return { chatLogPath, cwd: this.cwd }
      }

      const workspaceIds = readdirSync(userPath)

      for (const wsId of workspaceIds) {
        const wsPath = join(userPath, wsId)
        const workspaceFile = join(wsPath, 'workspace.json')

        if (!existsSync(workspaceFile)) {
          continue
        }

        try {
          const content = readFileSync(workspaceFile, 'utf8')
          const data = JSON.parse(content) as Record<string, string>

          // Only handle single folder windows (workspace files are ignored)
          if (!data.folder) {
            continue
          }

          const folderPath = decodeURIComponent(data.folder.replace('file://', ''))

          // Set chatLogPath ONLY if folder exactly matches cwd
          if (folderPath === this.cwd) {
            chatLogPath = wsPath
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return { chatLogPath, cwd: this.cwd }
  }

  /**
   * Check if current working directory is within the given workspace folder
   */
  private isCurrentDirInWorkspace(folderPath: string): boolean {
    // Exact match
    if (this.cwd === folderPath) {
      return true
    }

    // Check if current dir is a subdirectory
    if (this.cwd.startsWith(folderPath + '/')) {
      return true
    }

    return false
  }
}
