import {expect} from 'chai'
import chalk from 'chalk'

import type {IVcDiffFile, IVcDiffsResponse} from '../../../../../../src/shared/transport/events/vc-events.js'

import {formatDiff} from '../../../../../../src/tui/features/vc/diff/utils/format-diff.js'

// Force colorized output so assertions about ANSI sequences are stable regardless of TTY state.
chalk.level = 3

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[\d;]*m/g

function strip(s: string): string {
  return s.replaceAll(ANSI, '')
}

function file(overrides: Partial<IVcDiffFile> & Pick<IVcDiffFile, 'path' | 'status'>): IVcDiffFile {
  return {
    newContent: '',
    oldContent: '',
    ...overrides,
  } as IVcDiffFile
}

function res(diffs: IVcDiffFile[]): IVcDiffsResponse {
  return {diffs, mode: {kind: 'unstaged'}}
}

describe('formatDiff', () => {
  describe('empty / no-op cases', () => {
    it('returns empty string when there are no changed files (matches `git diff` output)', () => {
      expect(formatDiff(res([]))).to.equal('')
    })
  })

  describe('modified file', () => {
    it('emits git-diff-style header with diff --git, index, --- a/, +++ b/', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'hello\nworld\n',
              newOid: 'def4567',
              oldContent: 'hello\n',
              oldOid: 'abc1234',
              path: 'notes.md',
              status: 'modified',
            }),
          ]),
        ),
      )

      expect(out).to.include('diff --git a/notes.md b/notes.md')
      expect(out).to.include('index abc1234..def4567 100644')
      expect(out).to.include('--- a/notes.md')
      expect(out).to.include('+++ b/notes.md')
    })

    it('emits hunk header and +/- lines', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'a\nb\nc\nDELTA\n',
              newOid: 'bbbbbbb',
              oldContent: 'a\nb\nc\n',
              oldOid: 'aaaaaaa',
              path: 'x.txt',
              status: 'modified',
            }),
          ]),
        ),
      )

      expect(out).to.match(/^@@ -[\d,]+ \+[\d,]+ @@/m)
      expect(out).to.include('+DELTA')
    })

    it('omits `,1` in hunk ranges when count is 1 (matches git diff)', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'v2\n',
              newOid: 'bbbbbbb',
              oldContent: 'v1\n',
              oldOid: 'aaaaaaa',
              path: 'x.txt',
              status: 'modified',
            }),
          ]),
        ),
      )

      expect(out).to.include('@@ -1 +1 @@')
    })

    it('uses `0,0` on the empty side for added/deleted hunks (matches git diff)', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'fresh\n',
              newOid: 'bbbbbbb',
              path: 'new.md',
              status: 'added',
            }),
          ]),
        ),
      )

      expect(out).to.include('@@ -0,0 +1 @@')
    })

    it('colorizes additions green, deletions red, hunk headers cyan', () => {
      const out = formatDiff(
        res([
          file({
            newContent: 'kept\nadded\n',
            newOid: 'bbbbbbb',
            oldContent: 'kept\nremoved\n',
            oldOid: 'aaaaaaa',
            path: 'colorful.txt',
            status: 'modified',
          }),
        ]),
      )

      // eslint-disable-next-line no-control-regex
      expect(out).to.match(/\u001B\[32m\+added/) // green plus line
      // eslint-disable-next-line no-control-regex
      expect(out).to.match(/\u001B\[31m-removed/) // red minus line
      // eslint-disable-next-line no-control-regex
      expect(out).to.match(/\u001B\[36m@@ /) // cyan hunk header
    })
  })

  describe('added file', () => {
    it('uses /dev/null on the old side and emits new file mode header', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'fresh\n',
              newOid: 'bbbbbbb',
              path: 'new.md',
              status: 'added',
            }),
          ]),
        ),
      )

      expect(out).to.include('new file mode 100644')
      expect(out).to.include('index 0000000..bbbbbbb')
      expect(out).to.include('--- /dev/null')
      expect(out).to.include('+++ b/new.md')
    })
  })

  describe('deleted file', () => {
    it('uses /dev/null on the new side and emits deleted file mode header', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              oldContent: 'gone\n',
              oldOid: 'aaaaaaa',
              path: 'old.md',
              status: 'deleted',
            }),
          ]),
        ),
      )

      expect(out).to.include('deleted file mode 100644')
      expect(out).to.include('index aaaaaaa..0000000')
      expect(out).to.include('--- a/old.md')
      expect(out).to.include('+++ /dev/null')
    })
  })

  describe('binary handling', () => {
    it('emits "Binary files ... differ" and no hunks when binary=true', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              binary: true,
              newOid: 'bbbbbbb',
              oldOid: 'aaaaaaa',
              path: 'logo.png',
              status: 'modified',
            }),
          ]),
        ),
      )

      expect(out).to.include('Binary files a/logo.png and b/logo.png differ')
      expect(out).to.not.include('@@')
      expect(out).to.not.include('+++ b/logo.png')
    })

    it('uses /dev/null in binary marker for added files', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              binary: true,
              newOid: 'bbbbbbb',
              path: 'fresh.png',
              status: 'added',
            }),
          ]),
        ),
      )

      expect(out).to.include('Binary files /dev/null and b/fresh.png differ')
    })
  })

  describe('whitespace in path', () => {
    it('appends a tab after a/... path header when the path contains a space', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'v2\n',
              newOid: 'bbbbbbb',
              oldContent: 'v1\n',
              oldOid: 'aaaaaaa',
              path: 'has space.md',
              status: 'modified',
            }),
          ]),
        ),
      )

      // Unified-diff parsers need a tab after a path containing whitespace
      // so they can unambiguously detect the end of the path.
      expect(out).to.include('--- a/has space.md\t')
      expect(out).to.include('+++ b/has space.md\t')
    })
  })

  describe('empty patch', () => {
    it('omits --- / +++ when there are no hunks (e.g. empty file added)', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: '',
              newOid: 'bbbbbbb',
              path: 'empty.md',
              status: 'added',
            }),
          ]),
        ),
      )

      expect(out).to.include('new file mode 100644')
      expect(out).to.not.include('--- /dev/null')
      expect(out).to.not.include('+++ b/empty.md')
    })
  })

  describe('multi-file output', () => {
    it('concatenates per-file diffs with blank separation, ends with newline', () => {
      const out = strip(
        formatDiff(
          res([
            file({
              newContent: 'one-new\n',
              newOid: 'bbbbbbb',
              path: 'one.md',
              status: 'added',
            }),
            file({
              oldContent: 'two-old\n',
              oldOid: 'aaaaaaa',
              path: 'two.md',
              status: 'deleted',
            }),
          ]),
        ),
      )

      expect(out).to.include('diff --git a/one.md b/one.md')
      expect(out).to.include('diff --git a/two.md b/two.md')
      expect(out.endsWith('\n')).to.equal(true)
    })
  })
})
