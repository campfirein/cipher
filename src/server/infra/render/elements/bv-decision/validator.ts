import {makeAttributeValidator} from '../make-validator.js'
import {BvDecisionAttributesSchema} from './schema.js'

/**
 * Validate a `<bv-decision>` element node. M1 light validation; strict
 * per ADR-007 §13 is M2 work.
 */
export const validateBvDecision = makeAttributeValidator('bv-decision', BvDecisionAttributesSchema)
