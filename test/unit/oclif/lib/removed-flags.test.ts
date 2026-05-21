import {expect} from 'chai'

import {
  assertNoRemovedFlags,
  CURATE_REMOVED_FLAGS,
  QUERY_REMOVED_FLAGS,
  type RemovedFlag,
} from '../../../../src/oclif/lib/removed-flags.js'

describe('removed-flags', () => {
  describe('assertNoRemovedFlags', () => {
    const removed: RemovedFlag[] = [
      {flags: ['--gone', '-g'], migration: 'Use the new way.'},
    ]

    it('returns silently when none of the removed flags appear', () => {
      expect(() => assertNoRemovedFlags(['--ok', 'value'], removed)).to.not.throw()
    })

    it('throws with the migration text when the long flag appears', () => {
      expect(() => assertNoRemovedFlags(['--gone'], removed)).to.throw(
        /Flag '--gone' was removed in tool-mode\. Use the new way\./,
      )
    })

    it('throws when the short alias appears', () => {
      expect(() => assertNoRemovedFlags(['-g', 'x'], removed)).to.throw(
        /Flag '-g' was removed in tool-mode/,
      )
    })

    it('throws when the flag is written in --flag=value form', () => {
      expect(() => assertNoRemovedFlags(['--gone=oops'], removed)).to.throw(
        /Flag '--gone' was removed in tool-mode/,
      )
    })

    it('throws on the first match and does not check the rest', () => {
      const multi: RemovedFlag[] = [
        {flags: ['--first'], migration: 'first migration'},
        {flags: ['--second'], migration: 'second migration'},
      ]
      expect(() => assertNoRemovedFlags(['--second', '--first'], multi)).to.throw(/first migration/)
    })
  })

  describe('CURATE_REMOVED_FLAGS', () => {
    it('covers --folder/-d, --files/-f, --detach, --timeout', () => {
      const tokens = CURATE_REMOVED_FLAGS.flatMap((r) => r.flags)
      expect(tokens).to.include.members(['--folder', '-d', '--files', '-f', '--detach', '--timeout'])
    })

    it('every entry has a non-empty migration sentence', () => {
      for (const r of CURATE_REMOVED_FLAGS) {
        expect(r.migration.length).to.be.greaterThan(10)
        expect(r.migration).to.match(/\.$/)
      }
    })
  })

  describe('QUERY_REMOVED_FLAGS', () => {
    it('covers --timeout', () => {
      const tokens = QUERY_REMOVED_FLAGS.flatMap((r) => r.flags)
      expect(tokens).to.include('--timeout')
    })
  })
})
