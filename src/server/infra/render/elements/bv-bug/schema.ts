import {z} from 'zod'

/**
 * Zod schema for `<bv-bug>` attributes. M1 light validation; passthrough
 * tolerates unknown attributes (ADR-007 §13 strict validation is M2).
 */
export const BvBugAttributesSchema = z.object({
  id: z.string().min(1, {message: 'id must be non-empty if present'}).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
}).passthrough()
