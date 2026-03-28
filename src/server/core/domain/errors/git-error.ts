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
