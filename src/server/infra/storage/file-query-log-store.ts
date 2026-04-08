// Stub: minimal FileQueryLogStore for compilation (ENG-1897).
// Full implementation with Zod validation, atomic writes, and pruning in ENG-1889.

export class FileQueryLogStore {
  readonly baseDir: string

  constructor(opts: {baseDir: string}) {
    this.baseDir = opts.baseDir
  }
}
