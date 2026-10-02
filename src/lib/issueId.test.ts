import { describe, expect, it } from 'vitest'
import { displayIssueId, isTempIssueId, makeTempIssueId } from './issueId'
import { parseTicketPath } from './deepLink'

describe('ID provizoriu', () => {
  it('are prefixul proiectului și un marcaj imposibil într-un ID real', () => {
    const id = makeTempIssueId('HZ', () => 'a1b2c3')
    expect(id).toBe('HZ-~a1b2c3')
    expect(isTempIssueId(id)).toBe(true)
    expect(isTempIssueId('HZ-12')).toBe(false)
  })
  it('se afișează ca PREFIX-·', () => {
    expect(displayIssueId('HZ-~a1b2c3')).toBe('HZ-·')
    expect(displayIssueId('HZ-12')).toBe('HZ-12')
  })
  it('nu e recunoscut ca deep link — un URL provizoriu nu deschide nimic la repornire', () => {
    expect(parseTicketPath('/HZ-~a1b2c3')).toBeNull()
  })
  it('două ID-uri generate implicit diferă', () => {
    expect(makeTempIssueId('HZ')).not.toBe(makeTempIssueId('HZ'))
  })
})
