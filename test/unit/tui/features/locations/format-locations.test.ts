import {expect} from 'chai'

import type {ProjectLocationDTO} from '../../../../../src/shared/transport/types/dto.js'

import {formatLocations} from '../../../../../src/tui/features/locations/utils/format-locations.js'

// Strip ANSI escape codes so tests can assert on plain text
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replaceAll(/\u001B\[[0-9;]*m/g, '')
}

function makeLoc(overrides: Partial<ProjectLocationDTO> = {}): ProjectLocationDTO {
  return {
    domainCount: 0,
    fileCount: 0,
    isActive: false,
    isCurrent: false,
    isInitialized: false,
    projectPath: '/projects/foo',
    ...overrides,
  }
}

describe('formatLocations', () => {
  it('should show "none found" when empty', () => {
    const output = stripAnsi(formatLocations([]))
    expect(output).to.include('Registered Projects — none found')
  })

  it('should show count when locations exist', () => {
    const output = stripAnsi(formatLocations([makeLoc()]))
    expect(output).to.include('Registered Projects — 1 found')
  })

  it('should show project path', () => {
    const output = stripAnsi(formatLocations([makeLoc({projectPath: '/my/project'})]))
    expect(output).to.include('/my/project')
  })

  it('should show [current] label for current project', () => {
    const output = stripAnsi(formatLocations([makeLoc({isCurrent: true})]))
    expect(output).to.include('[current]')
  })

  it('should show [active] label for active project', () => {
    const output = stripAnsi(formatLocations([makeLoc({isActive: true})]))
    expect(output).to.include('[active]')
  })

  it('should show not initialized when context tree absent', () => {
    const output = stripAnsi(formatLocations([makeLoc({isInitialized: false})]))
    expect(output).to.include('(not initialized)')
  })

  it('should show domain and file counts when initialized', () => {
    const output = stripAnsi(formatLocations([makeLoc({domainCount: 3, fileCount: 12, isInitialized: true})]))
    expect(output).to.include('3 domains')
    expect(output).to.include('12 files')
  })

  it('should use singular labels for count of 1', () => {
    const output = stripAnsi(formatLocations([makeLoc({domainCount: 1, fileCount: 1, isInitialized: true})]))
    expect(output).to.include('1 domain')
    expect(output).to.include('1 file')
  })
})
