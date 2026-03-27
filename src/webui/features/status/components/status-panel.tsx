import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@campfirein/byterover-packages/components/table'

import { useGetStatus } from '../api/get-status'

export function StatusPanel() {
  const { data, error, isFetching, isLoading, refetch } = useGetStatus()
  const status = data?.status

  const allChanges =
    status?.contextTreeStatus === 'has_changes' && status.contextTreeChanges && status.contextTreeRelativeDir
      ? [
        ...status.contextTreeChanges.modified.map((path) => ({ kind: 'Modified', path })),
        ...status.contextTreeChanges.added.map((path) => ({ kind: 'Added', path })),
        ...status.contextTreeChanges.deleted.map((path) => ({ kind: 'Deleted', path })),
      ]
      : []

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-sm ring-border/70" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Project status</CardTitle>
            <CardDescription>A direct view of the daemon status payload.</CardDescription>
          </div>
          <CardAction className="flex flex-wrap gap-2.5">
            <Button className="cursor-pointer" disabled={isFetching} onClick={() => refetch()} size="lg">
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoading ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Loading status…</div> : null}
          {error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{error.message}</div> : null}

          {status ? (
            <div className="grid grid-cols-2 gap-3">
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Account</div>
                <div className="break-words">
                  {status.authStatus === 'logged_in'
                    ? status.userEmail ?? 'Logged in'
                    : status.authStatus === 'expired'
                      ? 'Session expired'
                      : status.authStatus === 'not_logged_in'
                        ? 'Not logged in'
                        : 'Unknown'}
                </div>
              </Card>
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Current directory</div>
                <div className="break-words">{status.currentDirectory}</div>
              </Card>
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Space</div>
                <div className="break-words">{status.teamName && status.spaceName ? `${status.teamName}/${status.spaceName}` : 'Not connected'}</div>
              </Card>
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Context tree</div>
                <div className="break-words">{status.contextTreeStatus}</div>
              </Card>
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Context tree directory</div>
                <div className="break-words">{status.contextTreeDir ?? 'Unavailable'}</div>
              </Card>
              <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                <div className="text-xs tracking-wider uppercase text-muted-foreground">Relative directory</div>
                <div className="break-words">{status.contextTreeRelativeDir ?? 'Unavailable'}</div>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {allChanges.length > 0 ? (
        <Card className="shadow-sm ring-border/70" size="sm">
          <CardHeader>
            <div>
              <CardTitle className="font-semibold">Context tree changes</CardTitle>
              <CardDescription>Files reported by the status transport event.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 text-xs tracking-wider uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="px-3 text-xs tracking-wider uppercase text-muted-foreground">Path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allChanges.map((change) => (
                  <TableRow key={`${change.kind}:${change.path}`}>
                    <TableCell className="px-3">{change.kind}</TableCell>
                    <TableCell className="px-3">{`${status?.contextTreeRelativeDir}/${change.path}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
