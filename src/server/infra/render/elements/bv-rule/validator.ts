import {makeAttributeValidator} from '../make-validator.js'
import {BvRuleAttributesSchema} from './schema.js'

/**
 * Validate a `<bv-rule>` element node. M1 light validation; strict per
 * ADR-007 §13 is M2 work.
 */
export const validateBvRule = makeAttributeValidator('bv-rule', BvRuleAttributesSchema)
