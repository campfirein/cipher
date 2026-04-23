import {useEffect} from 'react'
import {useLocation} from 'react-router-dom'

import {ConnectorsPanel} from '../features/connectors/components/connectors-panel'
import {IdentityPanel} from '../features/vc/components/identity-panel'
import {RemotesPanel} from '../features/vc/components/remotes-panel'

export function ConfigurationPage() {
  const {hash} = useLocation()

  useEffect(() => {
    if (!hash) return
    // Hash values are hard-coded below (#identity / #remotes / #connectors), so
    // using it directly as a selector is safe — no escaping needed.
    const el = document.querySelector(hash)
    if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'})
  }, [hash])

  return (
    <div className="flex flex-col items-center pt-8">
      <div className="flex w-full flex-col gap-6 md:gap-12 sm:max-w-lg md:max-w-xl lg:max-w-2xl">
        <section className="scroll-mt-4" id="identity">
          <IdentityPanel />
        </section>
        <section className="scroll-mt-4" id="remotes">
          <RemotesPanel />
        </section>
        <section className="scroll-mt-4" id="connectors">
          <ConnectorsPanel />
        </section>
      </div>
    </div>
  )
}
