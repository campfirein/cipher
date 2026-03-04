import type {GitConflict} from '../../interfaces/services/i-git-service.js'

export class GitError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export class GitAuthError extends GitError {
  public constructor(message = 'Git authentication failed. Try /login again.') {
    super(message)
    this.name = 'GitAuthError'
  }
}

export class GitConflictError extends GitError {
  public readonly conflicts: GitConflict[]

  public constructor(conflicts: GitConflict[]) {
    super(`Merge conflict in ${conflicts.length} file(s)`)
    this.name = 'GitConflictError'
    this.conflicts = conflicts
  }
}
