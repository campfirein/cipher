import {ConnectorsPanel} from '../features/connectors/components/connectors-panel'
import {IdentityPanel} from '../features/vc/components/identity-panel'
import {RemotesPanel} from '../features/vc/components/remotes-panel'

export function ConfigurationPage() {
  return (
    <div className="flex flex-col items-center pt-8">
      <div className="flex w-full flex-col gap-6 md:gap-12 sm:max-w-lg md:max-w-xl lg:max-w-2xl">
        <IdentityPanel />
        <RemotesPanel />
        <ConnectorsPanel />
      </div>
    </div>
  )
}
