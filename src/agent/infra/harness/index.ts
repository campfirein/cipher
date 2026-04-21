/**
 * AutoHarness V2 infra barrel.
 *
 * Re-exports the concrete classes and recorder helpers from the harness
 * module so consumers can `import {HarnessStore, HarnessOutcomeRecorder}
 * from '.../infra/harness'` without reaching into individual files.
 */

export {HarnessOutcomeRecorder} from './harness-outcome-recorder.js'
export {HarnessStore} from './harness-store.js'
