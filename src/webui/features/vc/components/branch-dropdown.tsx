import {Button} from '@campfirein/byterover-packages/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {Input} from '@campfirein/byterover-packages/components/input'
import {ArrowDownLeft, Axis3D, Check, ChevronDown, ChevronRight, GitBranch, GitCommit, Plus, Search} from 'lucide-react'
import {useMemo, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {toast} from 'sonner'

import type {VcBranch} from '../../../../shared/transport/events/vc-events'

import {formatError} from '../../../lib/error-messages'
import {useVcBranchSetUpstream} from '../api/execute-vc-branch-set-upstream'
import {useVcCheckout} from '../api/execute-vc-checkout'
import {useVcFetch} from '../api/execute-vc-fetch'
import {useVcPull} from '../api/execute-vc-pull'
import {useGetVcBranches} from '../api/get-vc-branches'
import {useGetVcStatus} from '../api/get-vc-status'
import {filterBranches} from '../utils/filter-branches'
import {partitionBranches} from '../utils/partition-branches'
import {withUnbornCurrent} from '../utils/with-unborn-current'
import {DeleteBranchDialog} from './delete-branch-dialog'
import {InitializeVcButton} from './initialize-vc-button'
import {NewBranchDialog} from './new-branch-dialog'

type DialogKind = 'new-branch' | null

type DeleteTarget = {branchName: string}

const TOAST_OPTS = {position: 'top-center'} as const

function triggerLabel(status: ReturnType<typeof useGetVcStatus>['data']): string {
  if (!status) return 'branch'
  if (!status.initialized) return 'No git repo'
  if (!status.branch) return 'detached'
  return status.branch
}

function stripHost(remoteName: string): string {
  const normalized = remoteName.startsWith('refs/remotes/') ? remoteName.slice('refs/remotes/'.length) : remoteName
  const slash = normalized.indexOf('/')
  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

export function BranchDropdown() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [prefillName, setPrefillName] = useState('')
  const [newBranchStartPoint, setNewBranchStartPoint] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [expandedRemotes, setExpandedRemotes] = useState<Set<string>>(new Set(['origin']))

  const statusQuery = useGetVcStatus()
  const branchesQuery = useGetVcBranches({
    queryConfig: {enabled: statusQuery.data?.initialized ?? false},
  })

  const checkout = useVcCheckout()
  const fetchMut = useVcFetch()
  const pull = useVcPull()
  const setUpstream = useVcBranchSetUpstream()

  const {locals, remotesByHost} = useMemo(() => {
    const merged = withUnbornCurrent(branchesQuery.data ?? [], statusQuery.data?.branch)
    const filtered = query.trim() === '' ? merged : filterBranches(merged, query)
    return partitionBranches(filtered)
  }, [branchesQuery.data, query, statusQuery.data?.branch])

  const {currentLocal, hasLocals, hasOtherLocals, otherLocals} = useMemo(() => {
    let current: undefined | VcBranch
    const others: VcBranch[] = []
    for (const b of locals) {
      if (b.isCurrent && !current) current = b
      else others.push(b)
    }

    return {
      currentLocal: current,
      hasLocals: locals.length > 0,
      hasOtherLocals: others.length > 0,
      otherLocals: others,
    }
  }, [locals])
  const hasRemotes = remotesByHost.size > 0

  function closeAndOpenDialog(kind: DialogKind, name = '') {
    setOpen(false)
    setPrefillName(name)
    setNewBranchStartPoint(undefined)
    setDialog(kind)
  }

  function openNewBranchFromRef(startPoint: string) {
    setOpen(false)
    setPrefillName(stripHost(startPoint))
    setNewBranchStartPoint(startPoint)
    setDialog('new-branch')
  }

  async function runCheckout(branchName: string, message: string) {
    setOpen(false)
    try {
      await checkout.mutateAsync({branch: branchName})
      toast.success(message, TOAST_OPTS)
    } catch (error) {
      toast.error('Failed to switch branch', {
        ...TOAST_OPTS,
        description: formatError(error),
      })
    }
  }

  function openDeleteDialog(branchName: string) {
    setOpen(false)
    setDeleteTarget({branchName})
  }

  async function handleRemoteCheckout(branch: VcBranch) {
    const localName = stripHost(branch.name)
    const existingLocal = (branchesQuery.data ?? []).find((b) => !b.isRemote && b.name === localName)
    if (existingLocal) {
      runCheckout(existingLocal.name, `Switched to ${existingLocal.name}`).catch(() => {})
      return
    }

    setOpen(false)
    try {
      await checkout.mutateAsync({branch: localName, create: true, startPoint: branch.name})
      // Best-effort: set the new local branch to track the remote ref it was
      // created from. Failure here doesn't undo the checkout — surface but
      // don't block the user.
      try {
        await setUpstream.mutateAsync(branch.name)
      } catch {
        // Tracking will fall back to unset; the user can retry via CLI.
      }

      toast.success(`Switched to ${localName} (tracking ${branch.name})`, TOAST_OPTS)
    } catch (error) {
      toast.error('Failed to checkout remote branch', {
        ...TOAST_OPTS,
        description: formatError(error),
      })
    }
  }

  function toggleRemote(host: string) {
    setExpandedRemotes((prev) => {
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  function handleFetchAll() {
    setOpen(false)
    toast.promise(fetchMut.mutateAsync({}), {
      ...TOAST_OPTS,
      error: (err: unknown) => ({
        description: formatError(err),
        message: 'Fetch failed',
      }),
      loading: 'Fetching from remote…',
      success: 'Fetched from remote',
    })
  }

  function handlePull() {
    setOpen(false)
    toast.promise(pull.mutateAsync({}), {
      ...TOAST_OPTS,
      error: (err: unknown) => ({
        description: formatError(err),
        message: 'Pull failed',
      }),
      loading: 'Updating project…',
      success: (result) => (result.alreadyUpToDate ? `${result.branch} is up to date` : `Pulled ${result.branch}`),
    })
  }

  const statusLoaded = statusQuery.data !== undefined
  const initialized = statusQuery.data?.initialized ?? false
  const label = triggerLabel(statusQuery.data)

  if (statusLoaded && !initialized) {
    return <InitializeVcButton />
  }

  return (
    <>
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger render={<Button disabled={!statusLoaded} variant="ghost" />}>
          <GitBranch className="size-4 shrink-0" />
          <span className="truncate max-w-40">{label}</span>
          <ChevronDown className="size-4 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-80 p-0" sideOffset={6}>
          <div className="flex items-center gap-1.5 p-2 border-b border-border">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search branches…"
                value={query}
              />
            </div>
            <Button
              className="shrink-0"
              disabled={fetchMut.isPending}
              onClick={handleFetchAll}
              size="icon-sm"
              title="Fetch"
              variant="ghost"
            >
              <Axis3D className={fetchMut.isPending ? 'size-4 animate-pulse' : 'size-4'} />
            </Button>
          </div>

          <div className="max-h-[60vh] overflow-x-hidden overflow-y-auto py-1">
            {query.trim() === '' && (
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={handlePull}>
                  <ArrowDownLeft className="size-5" />
                  <span>Update Project</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false)
                    navigate('/changes')
                  }}
                >
                  <GitCommit className="size-5" />
                  <span>Commit...</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => closeAndOpenDialog('new-branch', currentLocal?.name || '')}>
                  <Plus className="size-5" />
                  <span>New Branch...</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}

            {currentLocal ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Current</DropdownMenuLabel>
                  <LocalBranchSubmenu
                    branch={currentLocal}
                    onCheckout={() => {
                      runCheckout(currentLocal.name, `Switched to ${currentLocal.name}`).catch(() => {})
                    }}
                    onDelete={() => openDeleteDialog(currentLocal.name)}
                    onNewBranchFrom={() => openNewBranchFromRef(currentLocal.name)}
                    trackingBranch={statusQuery.data?.trackingBranch}
                  />
                </DropdownMenuGroup>
              </>
            ) : null}

            {hasOtherLocals && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Local</DropdownMenuLabel>
                  {otherLocals.map((branch) => (
                    <LocalBranchSubmenu
                      branch={branch}
                      key={branch.name}
                      onCheckout={() => {
                        runCheckout(branch.name, `Switched to ${branch.name}`).catch(() => {})
                      }}
                      onDelete={() => openDeleteDialog(branch.name)}
                      onNewBranchFrom={() => openNewBranchFromRef(branch.name)}
                    />
                  ))}
                </DropdownMenuGroup>
              </>
            )}

            {hasRemotes && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Remote</DropdownMenuLabel>
                  {[...remotesByHost.entries()].map(([host, branches]) => (
                    <RemoteGroup
                      branches={branches}
                      expanded={expandedRemotes.has(host)}
                      host={host}
                      key={host}
                      onBranchCheckout={handleRemoteCheckout}
                      onBranchNewBranchFrom={(branch) => openNewBranchFromRef(branch.name)}
                      onToggle={() => toggleRemote(host)}
                    />
                  ))}
                </DropdownMenuGroup>
              </>
            )}

            {!hasLocals && !hasRemotes && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {query ? 'No branches match your search.' : 'No branches.'}
              </p>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewBranchDialog
        initialName={prefillName}
        onOpenChange={(o) => (o ? null : setDialog(null))}
        open={dialog === 'new-branch'}
        startPoint={newBranchStartPoint}
      />

      <DeleteBranchDialog
        branchName={deleteTarget?.branchName ?? ''}
        onOpenChange={(o) => (o ? null : setDeleteTarget(null))}
        open={deleteTarget !== null}
      />
    </>
  )
}

function LocalBranchSubmenu({
  branch,
  onCheckout,
  onDelete,
  onNewBranchFrom,
  trackingBranch,
}: {
  branch: VcBranch
  onCheckout: () => void
  onDelete: () => void
  onNewBranchFrom: () => void
  /**
   * Only the current branch's tracking ref is known (from `vc:status`). Callers
   * for non-current local rows leave this undefined — it's not a UX choice,
   * the per-branch upstream simply isn't in the status payload.
   */
  trackingBranch?: string
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {branch.isCurrent ? <Check className="size-4 text-primary" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{branch.name}</span>
        {trackingBranch ? (
          <span className="shrink-0 truncate max-w-32 text-xs text-muted-foreground">{trackingBranch}</span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        {!branch.isCurrent && <DropdownMenuItem onClick={onCheckout}>Checkout</DropdownMenuItem>}
        <DropdownMenuItem onClick={onNewBranchFrom}>
          <span className="min-w-0 flex-1 truncate">New Branch from '{branch.name}'...</span>
        </DropdownMenuItem>
        {!branch.isCurrent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete}>Delete…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function RemoteGroup({
  branches,
  expanded,
  host,
  onBranchCheckout,
  onBranchNewBranchFrom,
  onToggle,
}: {
  branches: VcBranch[]
  expanded: boolean
  host: string
  onBranchCheckout: (branch: VcBranch) => void
  onBranchNewBranchFrom: (branch: VcBranch) => void
  onToggle: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <button
        className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted"
        onClick={onToggle}
        type="button"
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate text-left">{host}</span>
      </button>
      {expanded
        ? branches.map((branch) => (
            <RemoteBranchSubmenu
              branch={branch}
              key={branch.name}
              onCheckout={() => onBranchCheckout(branch)}
              onNewBranchFrom={() => onBranchNewBranchFrom(branch)}
            />
          ))
        : null}
    </div>
  )
}

function RemoteBranchSubmenu({
  branch,
  onCheckout,
  onNewBranchFrom,
}: {
  branch: VcBranch
  onCheckout: () => void
  onNewBranchFrom: () => void
}) {
  const displayName = stripHost(branch.name)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="pl-15">
        <span className="min-w-0 flex-1 truncate text-left">{displayName}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <DropdownMenuItem onClick={onCheckout}>Checkout</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewBranchFrom}>
          <span className="min-w-0 flex-1 truncate">New Branch from '{branch.name}'...</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
