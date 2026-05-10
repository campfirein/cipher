import {z} from 'zod'

/**
 * Zod schema for `<bv-topic>` attributes.
 *
 * HTML attributes arrive as strings. Numeric and enum constraints are
 * expressed via regex + refine, since HTML never gives us native numbers.
 *
 * `passthrough` is intentional: M1 is permissive on unknown attributes
 * (parse-and-skip — no warning is emitted). Strict validation per
 * ADR-007 §13 is M2 work.
 */
export const BvTopicAttributesSchema = z.object({
  importance: z
    .string()
    .regex(/^\d+$/, {message: 'importance must be an integer string "0".."100"'})
    .refine((v) => {
      const n = Number(v)
      return n >= 0 && n <= 100
    }, {message: 'importance must be in [0, 100]'})
    .optional(),
  maturity: z.enum(['draft', 'validated', 'core']).optional(),
  path: z.string().min(1, {message: 'path is required and must be non-empty'}),
  recency: z
    .string()
    .regex(/^\d+(\.\d+)?$/, {message: 'recency must be a numeric string'})
    .refine((v) => {
      const n = Number(v)
      return n >= 0 && n <= 1
    }, {message: 'recency must be in [0, 1]'})
    .optional(),
  // Lowercase per HTML5 attribute-name normalization (parse5 lowercases
  // `updatedAt="..."` to `updatedat`; schema keys must match the parser
  // output, not the source HTML). See element-types.ts attribute-case note.
  // `offset: true` accepts explicit timezone offsets like `+02:00` (e.g.
  // from `git log --date=iso-strict`), not only `Z`.
  updatedat: z.string().datetime({message: 'updatedat must be ISO-8601 datetime', offset: true}).optional(),
}).passthrough()
