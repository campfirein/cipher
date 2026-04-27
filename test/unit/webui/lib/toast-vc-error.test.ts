import type {NavigateFunction} from 'react-router-dom'

import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'
import {toast} from 'sonner'

import {VcErrorCode} from '../../../../src/shared/transport/events/vc-events.js'
import {toastVcError} from '../../../../src/webui/lib/toast-vc-error.js'

type ToastAction = {
  label: string
  onClick: () => void
}

function actionOf(call: SinonStub['firstCall']): ToastAction | undefined {
  // toast.error(message, options?) — we only care about options.action here.
  const options = call.args[1] as undefined | {action?: ToastAction}
  return options?.action
}

describe('toastVcError', () => {
  let toastErrorStub: SinonStub
  let navigate: NavigateFunction & SinonStub

  beforeEach(() => {
    toastErrorStub = stub(toast, 'error')
    navigate = stub() as unknown as NavigateFunction & SinonStub
  })

  afterEach(() => {
    restore()
  })

  it('attaches a "Set identity" action for ERR_VC_CONFIG_KEY_NOT_SET', () => {
    toastVcError(
      {code: VcErrorCode.CONFIG_KEY_NOT_SET, message: 'raw'},
      'fallback copy',
      navigate,
    )

    expect(toastErrorStub.calledOnce).to.be.true
    const action = actionOf(toastErrorStub.firstCall)
    expect(action?.label).to.equal('Set identity')

    action?.onClick()
    expect((navigate as unknown as SinonStub).calledOnceWith('/configuration')).to.be.true
  })

  it('attaches a "Set remote" action for ERR_VC_NO_REMOTE', () => {
    toastVcError({code: VcErrorCode.NO_REMOTE, message: 'raw'}, 'fallback copy', navigate)

    expect(toastErrorStub.calledOnce).to.be.true
    const action = actionOf(toastErrorStub.firstCall)
    expect(action?.label).to.equal('Set remote')

    action?.onClick()
    expect((navigate as unknown as SinonStub).calledOnceWith('/configuration')).to.be.true
  })

  it('calls toast.error with no action for an unknown error code', () => {
    toastVcError({code: 'ERR_SOMETHING_ELSE', message: 'unrecognised'}, 'fallback copy', navigate)

    expect(toastErrorStub.calledOnce).to.be.true
    // Second arg should be either undefined or a plain options object without
    // an `action` field — there's nothing to navigate to.
    const options = toastErrorStub.firstCall.args[1] as undefined | {action?: ToastAction}
    expect(options?.action).to.be.undefined
    expect((navigate as unknown as SinonStub).called).to.be.false
  })
})
