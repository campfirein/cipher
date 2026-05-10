import type {ElementRegistry} from '../../../core/domain/render/element-types.js'

import {validateBvBug} from './bv-bug/validator.js'
import {validateBvDecision} from './bv-decision/validator.js'
import {validateBvFix} from './bv-fix/validator.js'
import {validateBvRule} from './bv-rule/validator.js'
import {validateBvTopic} from './bv-topic/validator.js'

/**
 * The M1 element registry — single source of truth for the 5-element
 * vocabulary. M2 vocabulary expansion (12 more elements per Andy's
 * proposal §11) is **purely additive**: add a new entry here and a new
 * `<name>/{schema,validator}.ts` pair under `elements/`. No consumer
 * (writer, reader, indexer, prompt template generator) needs to be
 * touched — they all walk this registry generically.
 *
 * The data-driven shape is the production-track guardrail. If you find
 * yourself writing `switch (elementName)` anywhere in the render layer,
 * push back: that pattern doesn't scale to M2's vocabulary expansion.
 */
export const ELEMENT_REGISTRY: ElementRegistry = {
  'bv-bug': {
    allowedChildren: 'block',
    description:
      'A bug runbook entry (symptom, root cause, fix). Optional `id` and `severity` ' +
      '(low|medium|high|critical). Typically paired with a sibling `<bv-fix>`.',
    name: 'bv-bug',
    optionalAttributes: ['id', 'severity'],
    requiredAttributes: [],
    validator: validateBvBug,
  },
  'bv-decision': {
    allowedChildren: 'block',
    description:
      'A decision record (with rationale and evidence). Optional `id` for ' +
      'cross-referencing.',
    name: 'bv-decision',
    optionalAttributes: ['id'],
    requiredAttributes: [],
    validator: validateBvDecision,
  },
  'bv-fix': {
    allowedChildren: 'block',
    description:
      'A fix runbook entry (steps to resolve a bug). Optional `id`. Typically the ' +
      'sibling of a `<bv-bug>`.',
    name: 'bv-fix',
    optionalAttributes: ['id'],
    requiredAttributes: [],
    validator: validateBvFix,
  },
  'bv-rule': {
    allowedChildren: 'inline',
    description:
      'A rule statement the agent should follow. Optional `severity` (info|must|should) ' +
      'and `id` for cross-referencing.',
    name: 'bv-rule',
    optionalAttributes: ['severity', 'id'],
    requiredAttributes: [],
    validator: validateBvRule,
  },
  'bv-topic': {
    allowedChildren: 'any',
    description:
      'Root container per topic file. Carries file-level metadata as attributes ' +
      '(importance, maturity, recency, updatedat). Required: `path`. Note: ' +
      'attribute names MUST be lowercase — HTML5 normalizes them at parse time.',
    name: 'bv-topic',
    optionalAttributes: ['importance', 'maturity', 'recency', 'updatedat'],
    requiredAttributes: ['path'],
    validator: validateBvTopic,
  },
}
