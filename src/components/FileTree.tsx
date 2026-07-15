import { useEffect, useState } from 'react'
import { GitHubError, type GitHubClient } from '../github/client'
import { buildTree, type TreeNode } from '../github/tree'

// Renders the repo's file tree for the selected branch (P1-T4). One recursive
// Git Trees call builds the whole listing; directories expand/collapse, files
// are tappable and hand their path to onOpenFile (wired to the editor in P1-T5).
export function FileTree({
  client,
  owner,
  repo,
  branch,
  onOpenFile,
  activePath,
}: {
  client: GitHubClient
  owner: string
  repo: string
  branch: string
  onOpenFile: (path: string) => void
  activePath?: string | null
}) {
  const [nodes, setNodes] = useState<TreeNode[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setNodes(null)
    setError(null)
    setTruncated(false)
    client
      .getTree(owner, repo, branch, ctrl.signal)
      .then((tree) => {
        if (cancelled) return
        setNodes(buildTree(tree.tree))
        setTruncated(tree.truncated)
      })
      .catch((e) => {
        if (cancelled || ctrl.signal.aborted) return
        setError(e instanceof GitHubError ? e.message : 'Could not load the file tree.')
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [client, owner, repo, branch])

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!nodes) return <p className="text-sm text-muted">Loading tree…</p>
  if (nodes.length === 0) return <p className="text-sm text-muted">This branch has no files.</p>

  return (
    <div className="flex flex-col">
      {truncated && (
        <p className="mb-1 text-xs text-amber-400">
          Large repo — the tree was truncated by GitHub; some files may be hidden.
        </p>
      )}
      <ul className="text-sm">
        {nodes.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            activePath={activePath}
          />
        ))}
      </ul>
    </div>
  )
}

function TreeItem({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  activePath,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  activePath?: string | null
}) {
  const isDir = node.type === 'tree'
  const isOpen = expanded.has(node.path)
  const isActive = !isDir && node.path === activePath
  // Indent by depth; keep a comfortable ~40px min tap target for touch.
  const pad = { paddingLeft: `${depth * 0.9 + 0.5}rem` }

  return (
    <li>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onOpenFile(node.path))}
        style={pad}
        className={`flex w-full items-center gap-1.5 rounded py-2 pr-2 text-left hover:bg-white/5 ${
          isActive ? 'bg-accent/10 text-accent' : ''
        }`}
      >
        <span className="w-3 shrink-0 text-muted">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
        <span className={`truncate ${isDir ? 'text-white/80' : ''}`}>{node.name}</span>
      </button>
      {isDir && isOpen && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              activePath={activePath}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
