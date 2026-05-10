/**
 * Element type definitions for the M1 HTML render layer.
 *
 * This file is the type-only contract between:
 *  - the HTML parser (produces `ParsedNode` trees)
 *  - per-element validators (consume `ElementNode`s)
 *  - the element registry (catalogs `ElementSchema`s by `ElementName`)
 *  - downstream consumers (T3 curate writer, T4 query reader)
 *
 * See `features/html-memory-conversion/milestones/01-experiment/plan.md`
 * for the M1 vocabulary scope (5 elements). M2 expansion is purely
 * additive — adding an element name to `ELEMENT_NAMES` and a registry
 * entry is sufficient; no consumer needs to be touched.
 */

/**
 * The M1 element names. The HTML curate format must round-trip through
 * the markdown writer without information loss; the vocabulary covers
 * everything the writer renders into the `.md` file:
 *
 *   bv-topic        — root container; carries frontmatter as attributes.
 *   bv-reason       — `## Reason` body section.
 *   bv-task,        — `## Raw Concept` sub-fields:
 *   bv-changes,       Task / Changes / Files / Flow / Timestamp /
 *   bv-files,         Author / Patterns. (One sibling per emitted
 *   bv-flow,          bullet-label; multiple <bv-pattern> permitted.)
 *   bv-timestamp,
 *   bv-author,
 *   bv-pattern
 *   bv-structure,   — `## Narrative` sub-fields:
 *   bv-dependencies,  Structure / Dependencies / Highlights /
 *   bv-highlights,    Rules / Examples / Diagrams.
 *   bv-rule,
 *   bv-examples,
 *   bv-diagram
 *   bv-fact         — `## Facts` list entry (subject/category/value attrs).
 *   bv-decision     — net-new in M1: decision record.
 *   bv-bug, bv-fix  — net-new in M1: paired bug + fix runbook entries.
 *
 * Adding to this list must be an additive operation; downstream
 * consumers iterate the registry generically.
 */
export const ELEMENT_NAMES = [
  'bv-topic',
  'bv-reason',
  'bv-task',
  'bv-changes',
  'bv-files',
  'bv-flow',
  'bv-timestamp',
  'bv-author',
  'bv-pattern',
  'bv-structure',
  'bv-dependencies',
  'bv-highlights',
  'bv-rule',
  'bv-examples',
  'bv-diagram',
  'bv-fact',
  'bv-decision',
  'bv-bug',
  'bv-fix',
] as const

export type ElementName = typeof ELEMENT_NAMES[number]

/**
 * Normalized AST node produced by the HTML parser. Independent of any
 * specific parser library so we can swap implementations without
 * touching consumers.
 */
export type ParsedNode = DocumentNode | ElementNode | TextNode

export type ElementNode = {
  /**
   * Attribute map. Values are always strings (HTML attribute semantics).
   *
   * NOTE on key case: per the HTML5 parsing spec, attribute names are
   * lowercased during parsing — `updatedAt` in the source becomes
   * `updatedat` in this map. Downstream consumers (T3 writer, T4
   * reader) MUST emit and look up attributes in lowercase. Schemas
   * declared in per-element `schema.ts` files use lowercase to match.
   */
  attributes: Readonly<Record<string, string>>
  children: readonly ParsedNode[]
  /** Tag name, lowercased. May or may not be a registered `ElementName`. */
  tagName: string
  type: 'element'
}

export type TextNode = {
  text: string
  type: 'text'
}

export type DocumentNode = {
  children: readonly ParsedNode[]
  type: 'document'
}

/** A single validation issue. Field is informational (often the attribute name). */
export type ValidationError = {
  field: string
  message: string
}

/**
 * Validation outcome from a per-element validator. Discriminated union so
 * consumers can branch without optional-undefined gymnastics.
 */
export type ValidationResult =
  | {errors: readonly ValidationError[]; valid: false;}
  | {valid: true}

/**
 * Allowed-children semantic hint. Informational only in M1 — the
 * validator carries the enforcement; this is for documentation and the
 * curate prompt template generator (T3).
 */
export type AllowedChildren = 'any' | 'block' | 'inline' | 'none'

/**
 * Per-element registry entry. The validator is the load-bearing field;
 * everything else is metadata for the prompt template generator (T3) and
 * the structural-axis index (T4).
 */
export type ElementSchema = {
  /** Allowed-children semantic hint. Informational. */
  allowedChildren: AllowedChildren
  /** Human-readable description for the curate prompt template generator. */
  description: string
  name: ElementName
  /** Optional attribute names. Informational; the validator enforces. */
  optionalAttributes: readonly string[]
  /** Required attribute names. Informational; the validator enforces. */
  requiredAttributes: readonly string[]
  /** Validate an `ElementNode`'s tag name + attributes. Light validation in M1 (per-attribute Zod schema); strict per ADR-007 §13 in M2. */
  validator: (node: ElementNode) => ValidationResult
}

/** The full element registry — exactly one `ElementSchema` per `ElementName`. */
export type ElementRegistry = Readonly<Record<ElementName, ElementSchema>>
