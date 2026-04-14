import {expect} from 'chai'

import {formatCommitLog, formatRelativeDate} from '../../../../../../src/tui/features/log/utils/format-log.js'

function dateSecondsAgo(n: number): Date {
  return new Date(Date.now() - n * 1000)
}

const FIXED_DATE = new Date('2024-01-01T00:00:00Z').toISOString()

function makeLogCommit(overrides: {message?: string; sha?: string} = {}) {
  return {
    author: {email: 'dev@example.com', name: 'Dev User'},
    message: overrides.message ?? 'Initial commit',
    sha: overrides.sha ?? 'abc1234567890abcdef',
    timestamp: FIXED_DATE,
  }
}

describe('format-log', () => {
  describe('formatRelativeDate()', () => {
    it('should return seconds ago for recent timestamps', () => {
      expect(formatRelativeDate(dateSecondsAgo(30))).to.equal('30 seconds ago')
    })

    it('should use singular for 1 second', () => {
      expect(formatRelativeDate(dateSecondsAgo(1))).to.equal('1 second ago')
    })

    it('should return minutes ago', () => {
      expect(formatRelativeDate(dateSecondsAgo(90))).to.equal('1 minute ago')
      expect(formatRelativeDate(dateSecondsAgo(120))).to.equal('2 minutes ago')
    })

    it('should return hours ago', () => {
      expect(formatRelativeDate(dateSecondsAgo(3600))).to.equal('1 hour ago')
      expect(formatRelativeDate(dateSecondsAgo(7200))).to.equal('2 hours ago')
    })

    it('should return days ago', () => {
      expect(formatRelativeDate(dateSecondsAgo(86_400))).to.equal('1 day ago')
      expect(formatRelativeDate(dateSecondsAgo(86_400 * 3))).to.equal('3 days ago')
    })

    it('should return months ago', () => {
      expect(formatRelativeDate(dateSecondsAgo(86_400 * 35))).to.equal('1 month ago')
      expect(formatRelativeDate(dateSecondsAgo(86_400 * 65))).to.equal('2 months ago')
    })

    it('should return years ago', () => {
      expect(formatRelativeDate(dateSecondsAgo(86_400 * 400))).to.equal('1 year ago')
      expect(formatRelativeDate(dateSecondsAgo(86_400 * 800))).to.equal('2 years ago')
    })
  })

  describe('formatCommitLog()', () => {
    it('should return empty string for empty commits array', () => {
      expect(formatCommitLog([])).to.equal('')
    })

    it('should include short SHA (7 chars) in output', () => {
      const result = formatCommitLog([makeLogCommit({sha: 'abcdef1234567'})])
      expect(result).to.include('abcdef1')
      expect(result).not.to.include('abcdef1234567')
    })

    it('should include commit message in output', () => {
      const result = formatCommitLog([makeLogCommit({message: 'Fix the bug'})])
      expect(result).to.include('Fix the bug')
    })

    it('should include author name and email', () => {
      const result = formatCommitLog([makeLogCommit()])
      expect(result).to.include('Dev User')
      expect(result).to.include('dev@example.com')
    })

    it('should show (HEAD -> branch) on first commit when branch is known', () => {
      const result = formatCommitLog([makeLogCommit({sha: 'aaaaaaa1111111'})], 'main')
      expect(result).to.include('(HEAD -> main)')
    })

    it('should show (HEAD) on first commit when branch is unknown', () => {
      const result = formatCommitLog([makeLogCommit({sha: 'aaaaaaa1111111'})])
      expect(result).to.include('(HEAD)')
      expect(result).not.to.include('HEAD ->')
    })

    it('should not add HEAD marker to non-first commits', () => {
      const result = formatCommitLog(
        [makeLogCommit({sha: 'aaaaaaa1111111'}), makeLogCommit({sha: 'bbbbbbb2222222'})],
        'main',
      )
      const secondCommitBlock = result.split('\n\n')[1]
      expect(secondCommitBlock).to.not.include('HEAD')
    })

    it('should separate multiple commits with blank line', () => {
      const result = formatCommitLog(
        [makeLogCommit({sha: 'aaaaaaa1111111'}), makeLogCommit({sha: 'bbbbbbb2222222'})],
        'main',
      )
      expect(result).to.include('\n\n')
    })

    it('should start each commit with asterisk', () => {
      const result = formatCommitLog([makeLogCommit()], 'main')
      expect(result.trimStart()).to.match(/^\* /)
    })
  })
})
