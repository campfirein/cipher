import {z} from 'zod'

/**
 * Zod schema for `<bv-decision>` attributes. M1 light validation;
 * `passthrough` tolerates unknown attributes (ADR-007 §13 strict
 * validation is M2).
 */
export const BvDecisionAttributesSchema = z.object({
  id: z.string().min(1, {message: 'id must be non-empty if present'}).optional(),
}).passthrough()
