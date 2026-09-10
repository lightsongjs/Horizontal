import { describe, it, expect } from 'vitest'
import { dockedIssueIdFrom, type SheetState } from './ui'

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
