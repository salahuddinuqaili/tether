import type { GitTreeEntry } from './client'

// A node in the browsable file tree, nested from the flat path list the Git
// Trees API returns (P1-T4). Directories carry children; files are leaves.
export interface TreeNode {
  name: string
  path: string
  type: 'blob' | 'tree'
  children: TreeNode[]
}

// Turn GitHub's flat, recursive entry list into a nested, sorted tree. Intermediate
// directories are created from path segments even if a repo somehow omits a
// dedicated 'tree' entry, so the structure is always complete. Submodules
// ('commit' entries) are skipped — they aren't editable files.
export function buildTree(entries: GitTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'tree', children: [] }

  for (const entry of entries) {
    if (entry.type === 'commit') continue
    const leafType: 'blob' | 'tree' = entry.type === 'tree' ? 'tree' : 'blob'
    const segments = entry.path.split('/')
    let node = root
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]
      const isLeaf = i === segments.length - 1
      const path = segments.slice(0, i + 1).join('/')
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        // Leaf type comes from the entry; ancestors are always directories.
        child = { name, path, type: isLeaf ? leafType : 'tree', children: [] }
        node.children.push(child)
      }
      node = child
    }
  }

  sortChildren(root)
  return root.children
}

// Directories first, then files, each alphabetical (case-insensitive).
function sortChildren(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const child of node.children) sortChildren(child)
}
