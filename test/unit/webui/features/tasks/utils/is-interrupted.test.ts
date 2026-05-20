import {expect} from 'chai'

import {isInterrupted} from '../../../../../../src/webui/features/tasks/utils/is-interrupted.js'

describe('isInterrupted', () => {
  it('returns true when error.code === INTERRUPTED', () => {
    expect(
      isInterrupted({
        error: {code: 'INTERRUPTED', message: 'Interrupted (daemon terminated)', name: 'TaskError'},
        status: 'error',
      }),
    ).to.equal(true)
  })

  it('returns true when error.message matches the canonical interruption phrase', () => {
    expect(
      isInterrupted({
        error: {message: 'Interrupted (daemon terminated)', name: 'TaskError'},
        status: 'error',
      }),
    ).to.equal(true)
  })

  it('returns false for a genuine error with unrelated code/message', () => {
    expect(
      isInterrupted({
        error: {code: 'ERR_TOOL_FAILED', message: 'Tool failed', name: 'TaskError'},
        status: 'error',
      }),
    ).to.equal(false)
  })

  it('returns false for non-error statuses', () => {
    expect(isInterrupted({status: 'completed'})).to.equal(false)
    expect(isInterrupted({status: 'cancelled'})).to.equal(false)
    expect(isInterrupted({status: 'started'})).to.equal(false)
    expect(isInterrupted({status: 'created'})).to.equal(false)
  })

  it('returns false when error is undefined', () => {
    expect(isInterrupted({status: 'error'})).to.equal(false)
  })

  it('status guard fires before error inspection (completed status with INTERRUPTED code → false)', () => {
    expect(
      isInterrupted({
        error: {code: 'INTERRUPTED', message: 'Interrupted (daemon terminated)', name: 'TaskError'},
        status: 'completed',
      }),
    ).to.equal(false)
  })
})
