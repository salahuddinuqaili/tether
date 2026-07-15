import { idbDelete, idbGet, idbSet } from '../lib/idb'

// Remembers the last-selected repo + branch across reloads (P1-T3). Not a
// secret — just navigation context so the app reopens where you left off.
const SELECTION_KEY = 'selection'

export interface Selection {
  owner: string
  name: string
  defaultBranch: string
  branch: string
}

export function getSelection(): Promise<Selection | undefined> {
  return idbGet<Selection>(SELECTION_KEY)
}

export function saveSelection(selection: Selection): Promise<void> {
  return idbSet(SELECTION_KEY, selection)
}

export function clearSelection(): Promise<void> {
  return idbDelete(SELECTION_KEY)
}
