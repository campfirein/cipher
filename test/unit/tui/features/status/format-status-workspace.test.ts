/**
 * Tests for workspace-related fields in formatStatus() output.
 *
 * Pure function tests — no mocks, just crafted StatusDTO inputs.
 */

import {expect} from 'chai'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {formatStatus} from '../../../../../src/tui/features/status/utils/format-status.js'

function baseStatus(overrides: Partial<StatusDTO> = {}): StatusDTO {
  return {
    authStatus: 'logged_in',
    contextTreeStatus: 'no_changes',
    currentDirectory: '/projects/monorepo',
    projectRoot: '/projects/monorepo',
    userEmail: 'test@example.com',
    ...overrides,
  }
}

describe('formatStatus workspace fields', () => {
  it('should show workspace line when worktreeRoot differs from projectRoot', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: '/projects/monorepo/packages/api',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree: /projects/monorepo/packages/api (linked)')
  })

  it('should not show workspace line when worktreeRoot equals projectRoot', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: '/projects/monorepo',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Worktree:')
  })

  it('should not show workspace line when worktreeRoot is undefined', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: undefined,
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Worktree:')
  })

  it('should show shadowed link warning', () => {
    const status = baseStatus({
      shadowedLink: true,
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Shadowed .brv-worktree.json found')
    expect(output).to.include('.brv/ takes priority')
  })

  it('should not show shadowed link warning when false', () => {
    const status = baseStatus({
      shadowedLink: false,
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Shadowed')
  })

  it('should show resolver error message', () => {
    const status = baseStatus({
      resolverError: 'Worktree link broken: "/old/project" no longer has .brv/config.json.',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree link broken')
    expect(output).to.include('/old/project')
  })

  it('should show workspace, shadowed warning, and resolver error together', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      resolverError: 'Something went wrong',
      shadowedLink: true,
      worktreeRoot: '/projects/monorepo/packages/api',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree: /projects/monorepo/packages/api (linked)')
    expect(output).to.include('Shadowed .brv-worktree.json found')
    expect(output).to.include('Something went wrong')
  })

  it('should fall back to currentDirectory when projectRoot is undefined', () => {
    const status = baseStatus({
      currentDirectory: '/fallback/dir',
      projectRoot: undefined,
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Project: /fallback/dir')
  })
})
