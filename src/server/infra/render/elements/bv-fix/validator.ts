import {makeAttributeValidator} from '../make-validator.js'
import {BvFixAttributesSchema} from './schema.js'

/**
 * Validate a `<bv-fix>` element node. M1 light validation; strict per
 * ADR-007 §13 is M2 work.
 */
export const validateBvFix = makeAttributeValidator('bv-fix', BvFixAttributesSchema)
