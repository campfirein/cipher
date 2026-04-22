import { Badge } from '@campfirein/byterover-packages/components/badge'
import { Card, CardDescription, CardTitle } from '@campfirein/byterover-packages/components/card'

export function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-4 grid-cols-3">
        <Card className="gap-1 px-4 shadow-none ring-border/80" size="sm">
          <div className="text-xs tracking-wider uppercase text-muted-foreground">Total tasks</div>
          <strong className="text-3xl leading-none">0</strong>
          <CardDescription>Waiting for the skipped task-subscription issue.</CardDescription>
        </Card>
        <Card className="gap-1 px-4 shadow-none ring-border/80" size="sm">
          <div className="text-xs tracking-wider uppercase text-muted-foreground">Success rate</div>
          <strong className="text-3xl leading-none">0%</strong>
          <CardDescription>No client-side task history is wired into the web app yet.</CardDescription>
        </Card>
        <Card className="gap-1 px-4 shadow-none ring-border/80" size="sm">
          <div className="text-xs tracking-wider uppercase text-muted-foreground">Average duration</div>
          <strong className="text-3xl leading-none">0s</strong>
          <CardDescription>This will populate once task-store parity lands.</CardDescription>
        </Card>
      </section>

      <Card className="min-h-56 items-start justify-center gap-3 px-5 shadow-sm ring-border/70" size="sm">
        <Badge className="rounded-sm border-yellow-500/20 bg-yellow-500/10 text-yellow-600" variant="outline">Empty state</Badge>
        <CardTitle className="font-semibold">No task data available yet</CardTitle>
        <CardDescription>
          The plan explicitly skips the activity/task subscription issue. This page is wired as a placeholder so the
          route exists cleanly and can consume task-store data once that transport work lands.
        </CardDescription>
      </Card>
    </div>
  )
}
