import type {Agent} from '../domain/entities/agent.js'

export interface WorkspaceInfo {
  chatLogPath: string
  cwd: string
}

export interface IWorkspaceDetectorService {
  detectWorkspaces(agent: Agent): WorkspaceInfo
}
