// Parse the deterministic edit-proposal blocks the agent emits (SPEC §5.2). The app
// parses these itself rather than trusting a "write" tool call — far more reliable on
// a local model. A message may contain prose plus one or more blocks of the form:
//
//   ```tether-edit path=src/foo.ts
//   <entire new file content>
//   ```

export interface ProposedEdit {
  id: string
  path: string
  newContent: string
}

// Opening fence + path=... on one line, the full file body, then a closing ``` on its
// own line. `.` excludes newlines, so path= captures to the end of the opening line;
// the body is captured between the surrounding newlines (which stay outside the group).
const EDIT_BLOCK = /```tether-edit[ \t]+path=(.+)\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/g

export function parseProposedEdits(content: string): { text: string; edits: ProposedEdit[] } {
  const edits: ProposedEdit[] = []
  let index = 0
  const text = content
    .replace(EDIT_BLOCK, (_match, rawPath: string, body: string) => {
      const path = rawPath.trim().replace(/^["']|["']$/g, '')
      edits.push({ id: `edit-${index++}`, path, newContent: body })
      return '\n' // drop the raw block; a diff card replaces it in the rendered prose
    })
    .replace(/\n{3,}/g, '\n\n') // collapse the gap left where a block was removed
    .trim()
  return { text, edits }
}
