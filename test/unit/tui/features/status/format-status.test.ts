import {expect} from 'chai'

import type {ProjectLocationDTO, StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {formatStatus} from '../../../../../src/tui/features/status/utils/format-status.js'

// Strip ANSI escape codes so tests can assert on plain text
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replaceAll(/\u001B\[[0-9;]*m/g, '')
}

function makeStatus(locations: ProjectLocationDTO[]): StatusDTO {
  return {
    authStatus: 'logged_in',
    contextTreeStatus: 'no_changes',
    currentDirectory: '/test',
    locations,
    userEmail: 'user@example.com',
  }
}

function makeLoc(overrides: Partial<ProjectLocationDTO>): ProjectLocationDTO {
  return {
    domainCount: 0,
    fileCount: 0,
    isActive: false,
    isCurrent: false,
    isInitialized: false,
    projectPath: '/project/a',
    ...overrides,
  }
}

describe('formatStatus — locations section', () => {
  it('should show "none found" when locations is empty', () => {
    const output = stripAnsi(formatStatus(makeStatus([])))
    expect(output).to.include('Registered Projects — none found')
  })

  it('should show header with count when locations exist', () => {
    const locs = [makeLoc({projectPath: '/project/a'}), makeLoc({projectPath: '/project/b'})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('Registered Projects — 2 found')
  })

  it('should display project path for each location', () => {
    const locs = [makeLoc({projectPath: '/Users/andy/byterover'})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('/Users/andy/byterover')
  })

  it('should show [current] label for current project', () => {
    const locs = [makeLoc({isCurrent: true, projectPath: '/project/current'})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('[current]')
    expect(output).to.include('/project/current')
  })

  it('should show [active] label for active project', () => {
    const locs = [makeLoc({isActive: true, projectPath: '/project/active'})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('[active]')
    expect(output).to.include('/project/active')
  })

  it('should show domain and file counts when initialized', () => {
    const locs = [makeLoc({domainCount: 4, fileCount: 18, isInitialized: true})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('4 domains')
    expect(output).to.include('18 files')
  })

  it('should use singular "domain" and "file" when count is 1', () => {
    const locs = [makeLoc({domainCount: 1, fileCount: 1, isInitialized: true})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('1 domain')
    expect(output).to.not.include('1 domains')
    expect(output).to.include('1 file')
    expect(output).to.not.include('1 files')
  })

  it('should show (not initialized) when isInitialized=false', () => {
    const locs = [makeLoc({isInitialized: false})]
    const output = stripAnsi(formatStatus(makeStatus(locs)))
    expect(output).to.include('(not initialized)')
  })

  it('should show context tree relative path in tree line', () => {
    const output = stripAnsi(formatStatus(makeStatus([makeLoc({isInitialized: true})])))
    expect(output).to.include('.brv/context-tree/')
  })
})
