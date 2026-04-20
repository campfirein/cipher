import {Button} from '@campfirein/byterover-packages/components/button'
import {Link} from 'react-router-dom'

import notFoundIcon from '../assets/not-found.svg'

export function NotFoundPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-center">
      <img alt="" className="w-30" src={notFoundIcon} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-foreground text-xl font-medium">This page isn't available</h1>
        <p className="text-muted-foreground text-sm">We can't find a page with the url you entered.</p>
      </div>
      <Button className="px-4" nativeButton={false} render={<Link to="/" />} size="sm" variant="secondary">
        Back to Home
      </Button>
    </div>
  )
}
