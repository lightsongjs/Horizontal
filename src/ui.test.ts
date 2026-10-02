import { describe, it, expect } from 'vitest'
import { dockedIssueIdFrom, dockedKeyFrom, editSheet, renameIssueInSheets, sheetKey, type SheetState } from './ui'

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
