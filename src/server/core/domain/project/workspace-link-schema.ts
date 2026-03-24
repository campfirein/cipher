import {z} from 'zod'

/**
 * Schema for .brv-workspace.json — a workspace link file that points a subdirectory
 * to its parent project's .brv/ directory.
 */
export const WorkspaceLinkSchema = z.object({
  projectRoot: z.string().min(1),
})

export type WorkspaceLink = z.infer<typeof WorkspaceLinkSchema>
