import type {ConnectionResult} from '@campfirein/brv-transport-client'

/** Function type for transport connection (for DI/testing in use cases). */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>
