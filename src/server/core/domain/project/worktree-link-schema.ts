import {z} from 'zod'

/**
 * Schema for .brv-worktree.json — a worktree link file that points a subdirectory
 * to its parent project's .brv/ directory.
 */
export const WorktreeLinkSchema = z.object({
  projectRoot: z.string().min(1),
})

export type WorktreeLink = z.infer<typeof WorktreeLinkSchema>
