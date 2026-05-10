import type {ElementName} from '../../../core/domain/render/element-types.js'
import type {ElementAxisEntry} from './html-reader.js'

/**
 * In-memory index from element-shape lookups to topic file paths.
 *
 * Two query keys:
 *   - tag       — every path containing at least one element of that tag.
 *   - tag.attr=value — every path containing an element of that tag whose
 *                       attribute holds the given value.
 *
 * The structural-selector grammar consumes this for pre-filtering
 * before BM25 ranking (e.g., "give me topics with `<bv-rule
 * severity=must>`"). Today the search service accepts an optional
 * `elementHint` and uses this index to prune the candidate set; without
 * a hint, the index is dormant and the ranker walks the full corpus.
 *
 * The index is in-memory and lazy-built on first query for a project
 * (the search service materialises it from the same file walk that
 * builds the BM25 index). Invalidated whole-topic on every write —
 * mtime-based cache invalidation upstream catches this; T4 doesn't
 * need a finer-grained signal because a single curate run rewrites
 * exactly one topic file at a time.
 *
 * Persistence is deferred — rebuild on first-query-after-restart is
 * cheap (sub-100ms for the corpus sizes the bench produces).
 */
export class ElementAxisIndex {
  /** `tag.attr=value` → set of file paths containing such an element. */
  private readonly attrToPaths: Map<string, Set<string>> = new Map()
  /**
   * Reverse map from filePath → composite keys it contributed to. Lets
   * us drop a file from every membership in O(keys-it-touches) on
   * invalidation without scanning the full index.
   */
  private readonly pathToKeys: Map<string, Set<string>> = new Map()
  /** `tag` → set of file paths containing at least one element of that tag. */
  private readonly tagToPaths: Map<ElementName, Set<string>> = new Map()

  /** How many paths the index currently knows about. Mainly for tests. */
  public get size(): number {
    return this.pathToKeys.size
  }

  /**
   * Register every element in `entries` against `filePath`. Idempotent —
   * calling `add` twice for the same path stacks duplicates harmlessly
   * (Set semantics dedupes), but callers should `remove` first to keep
   * the path-to-keys reverse map accurate when re-indexing.
   */
  public add(filePath: string, entries: readonly ElementAxisEntry[]): void {
    let keys = this.pathToKeys.get(filePath)
    if (!keys) {
      keys = new Set()
      this.pathToKeys.set(filePath, keys)
    }

    for (const entry of entries) {
      this.addToTagIndex(entry.tag, filePath, keys)

      for (const [name, value] of Object.entries(entry.attributes)) {
        this.addToAttrIndex(entry.tag, name, value, filePath, keys)
      }
    }
  }

  /**
   * Drop every entry. Used on full corpus rebuild (after a project
   * switch or on first-query-after-restart).
   */
  public clear(): void {
    this.tagToPaths.clear()
    this.attrToPaths.clear()
    this.pathToKeys.clear()
  }

  /**
   * Paths containing an element of `tag` whose `attribute` holds the
   * exact `value`. Comparison is case-sensitive on values (HTML5
   * attribute names are lowercased at parse time, but values are
   * verbatim).
   */
  public findByAttribute(tag: ElementName, attribute: string, value: string): readonly string[] {
    const key = composeKey(tag, attribute, value)
    return [...(this.attrToPaths.get(key) ?? [])]
  }

  /**
   * Paths containing at least one element of `tag`. Empty array if no
   * matches (rather than `undefined`) so callers can treat the result
   * as a candidate set without null-checks.
   */
  public findByTag(tag: ElementName): readonly string[] {
    return [...(this.tagToPaths.get(tag) ?? [])]
  }

  /**
   * Drop every membership tied to `filePath`. Called before re-indexing
   * a touched topic, and when a topic file is deleted.
   */
  public remove(filePath: string): void {
    const keys = this.pathToKeys.get(filePath)
    if (!keys) return

    for (const key of keys) {
      const set = key.includes('=')
        ? this.attrToPaths.get(key)
        : this.tagToPaths.get(key as ElementName)
      if (!set) continue

      set.delete(filePath)
      if (set.size === 0) {
        if (key.includes('=')) {
          this.attrToPaths.delete(key)
        } else {
          this.tagToPaths.delete(key as ElementName)
        }
      }
    }

    this.pathToKeys.delete(filePath)
  }

  private addToAttrIndex(
    tag: ElementName,
    attribute: string,
    value: string,
    filePath: string,
    keys: Set<string>,
  ): void {
    const key = composeKey(tag, attribute, value)
    let set = this.attrToPaths.get(key)
    if (!set) {
      set = new Set()
      this.attrToPaths.set(key, set)
    }

    set.add(filePath)
    keys.add(key)
  }

  private addToTagIndex(tag: ElementName, filePath: string, keys: Set<string>): void {
    let set = this.tagToPaths.get(tag)
    if (!set) {
      set = new Set()
      this.tagToPaths.set(tag, set)
    }

    set.add(filePath)
    keys.add(tag)
  }
}

function composeKey(tag: ElementName, attribute: string, value: string): string {
  return `${tag}.${attribute}=${value}`
}
