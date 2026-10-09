import { describe, expect, it } from 'vitest'
import { inboxProjectId, isInboxProject, normalizeName, parseCaptureTokens } from './captureTokens'

const projects = [
  { id: 'd', name: '✅Daily', prefix: 'D' },
  { id: 'kata', name: 'Katalist', prefix: 'KATA' },
  { id: 'nk', name: 'Neveon-kata testare', prefix: 'NK' },
  { id: 'pg', name: 'Predare GDPR', prefix: 'PG' },
  { id: 'gdpr', name: 'GDPR', prefix: 'GDPR' },
  { id: 'r', name: 'Racovița', prefix: 'R' },
]
const assignees = [
  { id: 'a1', name: 'Alex Popescu' },
  { id: 'a2', name: 'Andrei' },
  { id: 'b1', name: 'Bogdan' },
]
const parse = (t: string) => parseCaptureTokens(t, projects, assignees)

describe('normalizeName', () => {
  it('scoate emoji, diacritice, spații', () => {
    expect(normalizeName('✅Daily')).toBe('daily')
    expect(normalizeName('Racovița')).toBe('racovita')
    expect(normalizeName('Predare GDPR')).toBe('predaregdpr')
  })
})

describe('parseCaptureTokens', () => {
  it('fără semne: titlul rămâne, nimic ales', () => {
    expect(parse('sună la bancă')).toEqual({ title: 'sună la bancă', projectId: null, assigneeId: null, urgent: false, unknown: [] })
  })
  it('#proiect după nume, fără emoji și fără diacritice', () => {
    expect(parse('sună #daily la bancă').projectId).toBe('d')
    expect(parse('sună #racovita').projectId).toBe('r')
    expect(parse('sună #daily la bancă').title).toBe('sună la bancă')
  })
  it('#proiect după prefix', () => {
    expect(parse('test #NK').projectId).toBe('nk')
  })
  it('numele exact bate începutul altui nume (#gdpr ≠ Predare GDPR)', () => {
    expect(parse('x #gdpr').projectId).toBe('gdpr')
  })
  it('un început de nume unic e de ajuns; unul ambiguu nu alege nimic', () => {
    expect(parse('x #kat').projectId).toBe('kata')
    expect(parse('x #ne').projectId).toBe('nk')
    expect(parse('x #zzz')).toMatchObject({ projectId: null, unknown: ['#zzz'], title: 'x #zzz' })
  })
  it('@persoană după prenume sau început unic', () => {
    expect(parse('raport @alex').assigneeId).toBe('a1')
    expect(parse('raport @bog').assigneeId).toBe('b1')
    expect(parse('raport @a')).toMatchObject({ assigneeId: null, unknown: ['@a'] })
  })
  it('două persoane cu același prenume: nu alege pe niciuna, token-ul rămâne necunoscut', () => {
    const dup = [...assignees, { id: 'a3', name: 'Alex Ionescu' }]
    expect(parseCaptureTokens('raport @alex', projects, dup)).toMatchObject({ assigneeId: null, unknown: ['@alex'] })
  })
  it('un ! singur e urgent; un ! lipit de cuvânt e punctuație', () => {
    expect(parse('sună acum !')).toMatchObject({ urgent: true, title: 'sună acum' })
    expect(parse('! sună')).toMatchObject({ urgent: true, title: 'sună' })
    expect(parse('sună acum!')).toMatchObject({ urgent: false, title: 'sună acum!' })
  })
  it('toate deodată', () => {
    expect(parse('sună la bancă #daily @alex !')).toEqual({ title: 'sună la bancă', projectId: 'd', assigneeId: 'a1', urgent: true, unknown: [] })
  })
  it('primul semn de un fel câștigă; al doilea rămâne text', () => {
    expect(parse('x #daily #kata')).toMatchObject({ projectId: 'd', title: 'x #kata' })
  })
  it('un email sau un # din mijlocul cuvântului nu e semn', () => {
    expect(parse('scrie lui ion@firma.ro despre C#')).toMatchObject({ assigneeId: null, projectId: null, title: 'scrie lui ion@firma.ro despre C#' })
  })
})

describe('inboxProjectId', () => {
  it('după id (`d`), oricum s-ar numi', () => {
    expect(inboxProjectId(projects)).toBe('d')
    expect(inboxProjectId([{ id: 'x', name: 'Daily' }, { id: 'd', name: 'Cutia mea' }])).toBe('d')
  })
  it('fără rândul `d`: după nume, vechi sau nou', () => {
    expect(inboxProjectId([{ id: 'x', name: 'Altceva' }, { id: 'p-daily', name: '✅Daily' }])).toBe('p-daily')
    expect(inboxProjectId([{ id: 'i', name: 'Inbox' }])).toBe('i')
    expect(inboxProjectId([{ id: 'x', name: 'Altceva' }])).toBeNull()
    expect(isInboxProject({ id: 'kata', name: 'Katalist' })).toBe(false)
  })
})

describe('#inbox și #daily după redenumire', () => {
  const renamed = projects.map((p) => (p.id === 'd' ? { ...p, name: 'Inbox' } : p))
  const parseR = (t: string) => parseCaptureTokens(t, renamed, assignees)
  it('numele vechi rămâne alias', () => {
    expect(parseR('sună #daily')).toMatchObject({ projectId: 'd', title: 'sună', unknown: [] })
  })
  it('numele nou și prefixul', () => {
    expect(parseR('sună #inbox')).toMatchObject({ projectId: 'd', title: 'sună' })
    expect(parseR('sună #inb')).toMatchObject({ projectId: 'd', title: 'sună' })
    expect(parseR('sună #d')).toMatchObject({ projectId: 'd' })
  })
  it('și înainte de redenumire, #inbox merge', () => {
    expect(parse('sună #inbox')).toMatchObject({ projectId: 'd', title: 'sună' })
  })
})
