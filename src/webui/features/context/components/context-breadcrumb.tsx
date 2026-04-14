import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@campfirein/byterover-packages/components/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {FileText, Folder, Home} from 'lucide-react'
import {Fragment, useMemo} from 'react'

import type {ContextNode} from '../types'

import {useContextTree} from '../hooks/use-context-tree'
import {findNodeByPath} from '../utils/tree-utils'

const MAX_VISIBLE_SEGMENTS = 3

function NodeIcon({type}: {type: ContextNode['type']}) {
  return type === 'tree' ? (
    <Folder className="text-secondary-foreground h-4 w-4.5" strokeWidth={2} />
  ) : (
    <FileText className="text-primary-foreground size-4" strokeWidth={2} />
  )
}

export function ContextBreadcrumb() {
  const {handleSelect, navigateHome, nodes, selectedPath} = useContextTree()

  const segments = useMemo(() => {
    if (!selectedPath) return []
    const parts = selectedPath.split('/').filter(Boolean)
    return parts
      .map((_, index) => {
        const segmentPath = parts.slice(0, index + 1).join('/')
        return findNodeByPath(nodes, segmentPath)
      })
      .filter((node): node is ContextNode => node !== undefined)
  }, [selectedPath, nodes])

  const shouldCollapse = segments.length > MAX_VISIBLE_SEGMENTS
  const hiddenSegments = shouldCollapse ? segments.slice(0, -2) : []
  const visibleSegments = shouldCollapse ? segments.slice(-2) : segments

  return (
    <Breadcrumb className="min-w-0 text-sm font-medium">
      <BreadcrumbList className="h-8 flex-nowrap gap-1 whitespace-nowrap sm:gap-1">
        <BreadcrumbItem>
          <BreadcrumbLink
            className="cursor-pointer rounded px-1 hover:bg-neutral-800"
            onClick={navigateHome}
          >
            <Home className="text-secondary-foreground size-4" />
          </BreadcrumbLink>
        </BreadcrumbItem>

        {shouldCollapse && (
          <>
            <BreadcrumbSeparator className="text-muted-foreground text-sm font-medium">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex h-5 cursor-pointer items-center rounded-sm outline-none hover:bg-neutral-800 focus-visible:outline-none">
                  <BreadcrumbEllipsis className="text-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {hiddenSegments.map((node) => (
                    <DropdownMenuItem
                      className="flex cursor-pointer items-center gap-2 hover:bg-neutral-800"
                      key={node.path}
                      onClick={() => handleSelect(node)}
                    >
                      <NodeIcon type={node.type} />
                      <span>{node.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}

        {visibleSegments.map((node, index) => {
          const isLast = index === visibleSegments.length - 1

          return (
            <Fragment key={node.path}>
              <BreadcrumbSeparator className="text-muted-foreground text-sm font-medium">/</BreadcrumbSeparator>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="text-secondary-foreground flex items-center gap-2 px-2 text-sm font-medium">
                    <NodeIcon type={node.type} />
                    <span>{node.name}</span>
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="text-muted-foreground flex cursor-pointer items-center gap-2 rounded px-2 text-sm font-medium hover:bg-neutral-800"
                    onClick={() => handleSelect(node)}
                  >
                    <NodeIcon type={node.type} />
                    <span>{node.name}</span>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
