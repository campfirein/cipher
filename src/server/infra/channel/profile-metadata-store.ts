import {promises as fs} from 'node:fs'
import {dirname, join} from 'node:path'

/**
 * Local-only metadata for driver profiles (Slice 4.2).
 *
 * `AgentDriverProfileSchema` in `src/shared/types/channel.ts` is the wire
 * spec — adding fields requires a `CHANNEL_PROTOCOL.md` amendment. The
 * AUTH_REQUIRED probe-failure state is host-local diagnostic information,
 * not protocol state, so it lives in this sibling file:
 *
 *   `<dataDir>/state/agent-driver-profile-metadata.json`
 *
 * Schema (intentionally narrow — extend only when a new local-only datum
 * is genuinely needed and clearly off the wire):
 *
 *   {
 *     "<profileName>": {
 *       "lastProbeError"?: "AUTH_REQUIRED",
 *       "lastProbeAt"?: "<ISO 8601>"
 *     }
 *   }
 *
 * Concurrency: atomic-rename writes, mode 0600. Last writer wins on
 * concurrent updates — acceptable for diagnostic-only state.
 */

export type ProfileLastProbeError = 'AUTH_REQUIRED'

export type ProfileMetadataRecord = {
  readonly lastProbeAt?: string
  readonly lastProbeError?: ProfileLastProbeError
}

export type SetLastProbeErrorArgs = {
  readonly at: string
  readonly error: ProfileLastProbeError
  readonly name: string
}

export interface IProfileMetadataStore {
  clearLastProbeError(name: string): Promise<void>
  get(name: string): Promise<ProfileMetadataRecord | undefined>
  setLastProbeError(args: SetLastProbeErrorArgs): Promise<void>
}

export type FileProfileMetadataStoreOptions = {
  readonly dataDir: string
}

const METADATA_SUBPATH = ['state', 'agent-driver-profile-metadata.json'] as const

type RegistryDoc = Record<string, ProfileMetadataRecord>

const isRegistryDoc = (value: unknown): value is RegistryDoc =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class FileProfileMetadataStore implements IProfileMetadataStore {
  private readonly dataDir: string

  public constructor(options: FileProfileMetadataStoreOptions) {
    this.dataDir = options.dataDir
  }

  async clearLastProbeError(name: string): Promise<void> {
    const doc = await this.readDoc()
    if (!(name in doc)) return
    delete doc[name]
    await this.writeAtomic(doc)
  }

  async get(name: string): Promise<ProfileMetadataRecord | undefined> {
    const doc = await this.readDoc()
    return doc[name]
  }

  async setLastProbeError(args: SetLastProbeErrorArgs): Promise<void> {
    const doc = await this.readDoc()
    doc[args.name] = {lastProbeAt: args.at, lastProbeError: args.error}
    await this.writeAtomic(doc)
  }

  private filePath(): string {
    return join(this.dataDir, ...METADATA_SUBPATH)
  }

  private async readDoc(): Promise<RegistryDoc> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isRegistryDoc(parsed)) return {}
      return parsed
    } catch (error) {
      const {code} = error as NodeJS.ErrnoException
      if (code === 'ENOENT') return {}
      // Corrupt JSON → recover by treating as empty. Subsequent writes
      // overwrite the corruption.
      return {}
    }
  }

  private async writeAtomic(doc: RegistryDoc): Promise<void> {
    const target = this.filePath()
    await fs.mkdir(dirname(target), {recursive: true})
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    await fs.writeFile(tmp, JSON.stringify(doc, undefined, 2), {encoding: 'utf8', mode: 0o600})
    await fs.rename(tmp, target)
    try {
      await fs.chmod(target, 0o600)
    } catch {
      // Best-effort on filesystems that don't support chmod.
    }
  }
}
