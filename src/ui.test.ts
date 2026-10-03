import { describe, it, expect } from 'vitest'
import { compactIssueIdFrom, dockedIssueIdFrom, dockedKeyFrom, editSheet, expandSheets, renameIssueInSheets, sheetKey, type SheetState } from './ui'

const form = (issueId?: string): SheetState => ({ kind: 'issue-form', issueId })

describe('dockedIssueIdFrom', () => {
  it('docheză formularul de editare când există o gazdă', () => {
    expect(dockedIssueIdFrom([form('HZ-12')], true)).toBe('HZ-12')
  })

  it('fără gazdă nu docheză nimic — pe mobil totul rămâne modal', () => {
    expect(dockedIssueIdFrom([form('HZ-12')], false)).toBeNull()
  })

  it('un tichet nou stă în modal: n-are rând de evidențiat în listă', () => {
    expect(dockedIssueIdFrom([form()], true)).toBeNull()
  })

  it('un card de dependență împins deasupra scoate formularul din panou', () => {
    const stack: SheetState[] = [form('HZ-12'), { kind: 'issue', issueId: 'HZ-20' }]
    expect(dockedIssueIdFrom(stack, true)).toBeNull()
  })

  it('celelalte foi nu se docheză niciodată', () => {
    expect(dockedIssueIdFrom([{ kind: 'project-settings' }], true)).toBeNull()
    expect(dockedIssueIdFrom([], true)).toBeNull()
  })
})

describe('redenumirea temp → real păstrează cheia React', () => {
  it('foile cu ID-ul vechi trec pe cel nou și țin minte cheia veche', () => {
    const stack: SheetState[] = [form('HZ-~ab12cd'), { kind: 'issue', issueId: 'HZ-~ab12cd' }, form('HZ-3')]
    expect(renameIssueInSheets(stack, 'HZ-~ab12cd', 'HZ-13')).toEqual([
      { kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' },
      { kind: 'issue', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' },
      form('HZ-3'),
    ])
  })

  it('a doua redenumire nu mută cheia — rămâne cea de la montare', () => {
    const once = renameIssueInSheets([form('HZ-~ab12cd')], 'HZ-~ab12cd', 'HZ-13')
    expect(renameIssueInSheets(once, 'HZ-13', 'HZ-14')).toEqual([{ kind: 'issue-form', issueId: 'HZ-14', keyId: 'HZ-~ab12cd' }])
  })

  it('fără nimic de redenumit întoarce aceeași stivă (nicio randare degeaba)', () => {
    const stack = [form('HZ-3')]
    expect(renameIssueInSheets(stack, 'HZ-~ab12cd', 'HZ-13')).toBe(stack)
  })

  it('cheia e `keyId` dacă există, altfel ID-ul', () => {
    expect(sheetKey({ kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' })).toBe('HZ-~ab12cd')
    expect(sheetKey({ kind: 'issue-form', issueId: 'HZ-13' })).toBe('HZ-13')
    expect(sheetKey({ kind: 'issue-form' })).toBeUndefined()
  })

  it('panoul docat folosește aceeași cheie, cu aceleași reguli ca docarea', () => {
    const renamed: SheetState[] = [{ kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' }]
    expect(dockedKeyFrom(renamed, true)).toBe('HZ-~ab12cd')
    expect(dockedKeyFrom([form('HZ-13')], true)).toBe('HZ-13')
    expect(dockedKeyFrom(renamed, false)).toBeNull()
  })

  it('un click pe rândul tichetului deja deschis nu schimbă cheia (deci nu remontează)', () => {
    const renamed: SheetState[] = [{ kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' }]
    expect(editSheet(renamed, 'HZ-13')).toEqual({ kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~ab12cd' })
    expect(editSheet(renamed, 'HZ-14')).toEqual(form('HZ-14'))
    expect(editSheet([], 'HZ-14')).toEqual(form('HZ-14'))
  })
})

describe('compactIssueIdFrom (foaia de tichet de pe telefon)', () => {
  it('pe telefon, un tichet existent singur pe stivă → foaia scurtă', () => {
    expect(compactIssueIdFrom(form('HZ-12'), 1, true)).toBe('HZ-12')
  })
  it('pe ecran lat rămâne formularul', () => {
    expect(compactIssueIdFrom(form('HZ-12'), 1, false)).toBeNull()
  })
  it('un tichet nou și „…" (full) merg în formularul complet', () => {
    expect(compactIssueIdFrom(form(), 1, true)).toBeNull()
    expect(compactIssueIdFrom({ kind: 'issue-form', issueId: 'HZ-12', full: true }, 1, true)).toBeNull()
  })
  it('cu ceva sub ea pe stivă (card de dependență deasupra) nu e foaia scurtă', () => {
    expect(compactIssueIdFrom(form('HZ-12'), 2, true)).toBeNull()
  })
})

describe('expandSheets / editSheet cu full', () => {
  it('„…" păstrează cheia și pune full', () => {
    expect(expandSheets([{ kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~a' }])).toEqual([
      { kind: 'issue-form', issueId: 'HZ-13', keyId: 'HZ-~a', full: true },
    ])
  })
  it('fără un singur tichet existent, stiva rămâne aceeași', () => {
    const stack: SheetState[] = [form('HZ-1'), { kind: 'issue', issueId: 'HZ-2' }]
    expect(expandSheets(stack)).toBe(stack)
  })
  it('formularul complet redeschis pe același tichet rămâne complet', () => {
    expect(editSheet([{ kind: 'issue-form', issueId: 'HZ-1', full: true }], 'HZ-1')).toEqual({ kind: 'issue-form', issueId: 'HZ-1', full: true })
    expect(editSheet([{ kind: 'issue-form', issueId: 'HZ-1', full: true }], 'HZ-2')).toEqual(form('HZ-2'))
    expect(editSheet([], 'HZ-3', true)).toEqual({ kind: 'issue-form', issueId: 'HZ-3', full: true })
  })
})
