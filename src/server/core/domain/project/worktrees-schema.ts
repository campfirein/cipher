import {z} from 'zod'

/**
 * Schema for the `.brv` pointer file (when .brv is a FILE, not a directory).
 * Like git's `.git` file in worktrees: contains a single `projectRoot` field
 * pointing to the parent project's absolute path.
 */
export const WorktreePointerSchema = z.object({
  projectRoot: z.string().min(1),
})

export type WorktreePointer = z.infer<typeof WorktreePointerSchema>

/**
 * Schema for `.brv/worktrees/<name>/link.json` — metadata about a registered worktree.
 * Stored in the parent project's `.brv/worktrees/` directory (like `.git/worktrees/`).
 */
export const WorktreeLinkMetadataSchema = z.object({
  addedAt: z.string().optional(),
  worktreePath: z.string().min(1),
})

export type WorktreeLinkMetadata = z.infer<typeof WorktreeLinkMetadataSchema>
