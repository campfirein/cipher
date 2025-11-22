import type * as sinon from 'sinon'

import { expect } from 'chai'
import { createSandbox, type SinonSandbox } from 'sinon'

import { displayInfo } from '../../../../src/infra/cipher/interactive-loop.js'

describe('interactive-loop', () => {
    let sandbox: SinonSandbox
    let consoleLogStub: sinon.SinonStub

    beforeEach(() => {
        sandbox = createSandbox()

        // Suppress console output
        consoleLogStub = sandbox.stub(console, 'log')
    })

    afterEach(() => {
        sandbox.restore()
    })

    describe('displayInfo()', () => {
        it('should be exported and callable', () => {
            expect(displayInfo).to.be.a('function')
        })

        it('should call console.log with formatted message', () => {
            displayInfo('Test message')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include('Test message')
            expect(message).to.include('ℹ️')
        })

        it('should handle empty message', () => {
            displayInfo('')

            expect(consoleLogStub.calledOnce).to.be.true
        })

        it('should handle special characters', () => {
            displayInfo('Message with 🎉 emojis and <html>')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include('🎉')
            expect(message).to.include('<html>')
        })

        it('should format message with gray color and info icon', () => {
            displayInfo('Info test')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            // Chalk wraps text, so just verify core content
            expect(message).to.include('ℹ️  Info test')
        })

        it('should handle long messages', () => {
            const longMessage = 'a'.repeat(500)
            displayInfo(longMessage)

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include(longMessage)
        })

        it('should handle messages with newlines', () => {
            displayInfo('Line 1\nLine 2\nLine 3')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            // Chalk color wrapping may modify newlines, just check content is present
            expect(message).to.include('Line 1')
            expect(message).to.include('Line 2')
            expect(message).to.include('Line 3')
        })

        it('should handle messages with special characters', () => {
            displayInfo('Test with quotes "abc" and \'xyz\'')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include('quotes')
        })

        it('should be called multiple times independently', () => {
            displayInfo('First')
            displayInfo('Second')
            displayInfo('Third')

            expect(consoleLogStub.callCount).to.equal(3)
            expect(consoleLogStub.firstCall.args[0]).to.include('First')
            expect(consoleLogStub.secondCall.args[0]).to.include('Second')
            expect(consoleLogStub.thirdCall.args[0]).to.include('Third')
        })

        it('should handle unicode characters', () => {
            displayInfo('Unicode test: 你好 مرحبا')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include('你好')
            expect(message).to.include('مرحبا')
        })

        it('should handle numbers and booleans when converted to strings', () => {
            displayInfo('Number: 42, Boolean: true')

            expect(consoleLogStub.calledOnce).to.be.true
            const message = consoleLogStub.firstCall.args[0]
            expect(message).to.include('42')
            expect(message).to.include('true')
        })
    })

    // Note: Integration tests for startInteractiveLoop() are omitted due to ES module limitations
    // with Sinon stubbing. The function is tested through manual/integration testing.
    // The core parsing logic is tested in command-parser.test.ts
    // The command execution logic is tested in interactive-commands.test.ts
})
