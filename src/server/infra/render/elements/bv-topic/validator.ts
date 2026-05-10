import {makeAttributeValidator} from '../make-validator.js'
import {BvTopicAttributesSchema} from './schema.js'

/**
 * Validate a `<bv-topic>` element node. Light validation per M1
 * (per-attribute Zod schema in `./schema.ts`); strict per ADR-007 §13
 * is M2 work.
 */
export const validateBvTopic = makeAttributeValidator('bv-topic', BvTopicAttributesSchema)
