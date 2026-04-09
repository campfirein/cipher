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
  it('should show worktree line when worktreeRoot differs from projectRoot', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: '/projects/monorepo/packages/api',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree: /projects/monorepo/packages/api (linked)')
  })

  it('should not show worktree line when worktreeRoot equals projectRoot', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: '/projects/monorepo',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Worktree:')
  })

  it('should not show worktree line when worktreeRoot is undefined', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      worktreeRoot: undefined,
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Worktree:')
  })

  it('should show resolver error message', () => {
    const status = baseStatus({
      resolverError: 'Worktree pointer broken: "/old/project" no longer has .brv/config.json.',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree pointer broken')
    expect(output).to.include('/old/project')
  })

  it('should show worktree and resolver error together', () => {
    const status = baseStatus({
      projectRoot: '/projects/monorepo',
      resolverError: 'Something went wrong',
      worktreeRoot: '/projects/monorepo/packages/api',
    })

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Worktree: /projects/monorepo/packages/api (linked)')
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
