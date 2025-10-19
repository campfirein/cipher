import {expect} from 'chai'
import {restore, SinonStub, stub} from 'sinon'

import {SystemBrowserLauncher} from '../../../../src/infra/browser/system-browser-launcher'

describe('SystemBrowserLauncher', () => {
  let launcher: SystemBrowserLauncher
  let openStub: SinonStub

  beforeEach(async () => {
    openStub = stub()
    launcher = new SystemBrowserLauncher(openStub)
  })

  afterEach(() => {
    restore()
  })

  describe('open', () => {
    it('should open URL in default browser', async () => {
      const url = 'https://example.com'

      openStub.resolves()

      await launcher.open(url)

      expect(openStub.calledOnce).to.be.true
      expect(openStub.calledWith(url)).to.be.true
    })

    it('should throw error if browser launch fails', async () => {
      openStub.rejects(new Error('Failed to launch browser'))

      try {
        await launcher.open('https://example.com')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to launch browser')
      }
    })
  })
})
