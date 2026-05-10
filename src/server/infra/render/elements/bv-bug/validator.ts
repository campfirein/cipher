import {makeAttributeValidator} from '../make-validator.js'
import {BvBugAttributesSchema} from './schema.js'

/**
 * Validate a `<bv-bug>` element node. M1 light validation; strict per
 * ADR-007 §13 is M2 work.
 */
export const validateBvBug = makeAttributeValidator('bv-bug', BvBugAttributesSchema)
