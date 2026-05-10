import {z} from 'zod'

/**
 * Zod schema for `<bv-topic>` attributes.
 *
 * `<bv-topic>` carries the topic file's frontmatter as attributes. The
 * markdown writer maps these directly to YAML frontmatter on disk.
 *
 * Notably absent: `importance`, `maturity`, `recency`, `updatedat`,
 * `createdAt`. Per the runtime-signals migration, ranking signals are
 * sidecar* state — per-user, per-machine — not file content.
 * Including them as attributes here would re-introduce the
 * noise-from-implicit-state problem the migration solved. The system
 * writes timestamps; the LLM does not.
 *
 * `passthrough` is intentional: light validation is permissive on
 * unknown attributes (parse-and-skip — no warning is emitted). Strict
 * validation per ADR-007 §13 is future work.
 */
export const BvTopicAttributesSchema = z.object({
  // Comma-separated lists are the natural HTML-attribute encoding for
  // arrays. The writer splits on `,` and trims; empty list is `""`.
  keywords: z.string().optional(),
  path: z.string().min(1, {message: 'path is required and must be non-empty'}),
  related: z.string().optional(),
  summary: z.string().optional(),
  tags: z.string().optional(),
  title: z.string().min(1, {message: 'title is required and must be non-empty'}),
}).passthrough()
