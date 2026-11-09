import { describe, expect, it } from 'vitest'
import quickAddSrc from '../components/QuickAdd.tsx?raw'
import quickSheetSrc from '../components/QuickSheet.tsx?raw'
import { captureDefaultProjectId, draftSchedule, dueLabel, dueLabelParts, keyboardInset, seriesDueLabel, quickKey, resolveDraft, type DraftDate, type DraftInput, type QuickCtx } from './quickDraft'
import type { CaptureTokens } from './captureTokens'

const TODAY = '2026-10-03T00:00:00.000Z'
const TEN = '2026-10-04T07:00:00.000Z'
const LIST: QuickCtx = { mode: 'list', defaultDueAt: TODAY }
const PROJ: QuickCtx = { mode: 'project', projectId: 'p1', wave: 2 }

const noDate = (title: string): DraftDate => ({ active: false, dueAt: null, allDay: true, rrule: null, title })
const withDate = (title: string, rrule: string | null = null): DraftDate => ({ active: true, dueAt: TEN, allDay: false, rrule, title })

const input = (over: Partial<DraftInput>): DraftInput => ({
  text: 'Sună la bancă',
  desc: '',
  date: noDate('Sună la bancă'),
  tokens: null,
  manual: {},
  projectId: 'p1',
  ctx: LIST,
  ...over,
})

describe('resolveDraft', () => {
  it('în listă, fără dată în text: ziua listei, toată ziua, fără memento', () => {
    expect(resolveDraft(input({}))).toEqual({
      projectId: 'p1', title: 'Sună la bancă', desc: '', dueAt: TODAY, allDay: true, remindAt: null, rrule: null,
    })
  })

  it('în proiect, fără dată în text: fără scadență, în valul activ', () => {
    const r = resolveDraft(input({ ctx: PROJ }))
    expect(r).toMatchObject({ dueAt: null, remindAt: null, rrule: null, wave: 2 })
  })

  it('în proiect, mutată în alt proiect: valul rămâne al depozitului', () => {
    const r = resolveDraft(input({ ctx: PROJ, projectId: 'p2' }))
    expect(r).not.toHaveProperty('wave')
  })

  it('data din text bate implicitul, cu memento la oră', () => {
    const r = resolveDraft(input({ text: 'Sună la bancă mâine la 10', date: withDate('Sună la bancă'), ctx: PROJ }))
    expect(r).toMatchObject({ title: 'Sună la bancă', dueAt: TEN, allDay: false, remindAt: TEN })
  })

  it('recurența din text se păstrează…', () => {
    const r = resolveDraft(input({ text: 'Apă la flori zilnic la 10', date: withDate('Apă la flori', 'FREQ=DAILY') }))
    expect(r).toMatchObject({ rrule: 'FREQ=DAILY', dueAt: TEN })
  })

  it('…dar cade la o dată aleasă de mână', () => {
    const r = resolveDraft(input({
      text: 'Apă la flori zilnic la 10',
      date: withDate('Apă la flori', 'FREQ=DAILY'),
      manual: { due: { dueAt: TODAY, allDay: true } },
    }))
    expect(r).toMatchObject({ rrule: null, dueAt: TODAY, allDay: true })
  })

  it('„fără dată” ales de mână bate și ziua listei', () => {
    expect(draftSchedule(noDate('x'), { due: { dueAt: null, allDay: true } }, LIST)).toEqual({ dueAt: null, allDay: true, rrule: null, pingEvery: null, remindAt: null })
  })

  it('text numai-dată: „bare”, nu o sarcină fără titlu', () => {
    expect(resolveDraft(input({ text: 'mâine la 10', date: withDate('') }))).toEqual({ error: 'bare' })
  })

  it('câmp gol: „empty”, chiar cu descriere', () => {
    expect(resolveDraft(input({ text: '   ', desc: 'ceva' }))).toEqual({ error: 'empty' })
  })

  it('descrierea pleacă tăiată de spații', () => {
    expect(resolveDraft(input({ desc: '  \n detalii\n\n ' }))).toMatchObject({ desc: 'detalii' })
  })

  it('cu semne: titlul fără ele, omul și urgența din text, butonul bate semnul', () => {
    const tokens: CaptureTokens = { title: 'Factura', projectId: null, assigneeId: 'a1', urgent: true, unknown: [] }
    const r = resolveDraft(input({ text: 'Factura @ana !', date: noDate('Factura @ana !'), tokens, manual: { urgent: false } }))
    expect(r).toMatchObject({ title: 'Factura', assigneeId: 'a1', urgent: false })
  })

  it('fără semne (rândul din listă): nici om, nici urgență în cerere', () => {
    const r = resolveDraft(input({}))
    expect(r).not.toHaveProperty('assigneeId')
    expect(r).not.toHaveProperty('urgent')
  })
})

describe('quickKey', () => {
  const k = (over: Partial<Parameters<typeof quickKey>[0]>) =>
    quickKey({ key: 'a', shift: false, mod: false, field: 'title', titleEmpty: false, descEmpty: true, ...over })

  it.each([
    ['Enter în titlu salvează', { key: 'Enter' }, 'submit'],
    ['Ctrl+Enter în titlu salvează', { key: 'Enter', mod: true }, 'submit'],
    ['Tab peste un titlu început deschide descrierea', { key: 'Tab' }, 'open-desc'],
    ['Tab pe titlu gol rămâne navigare', { key: 'Tab', titleEmpty: true }, null],
    ['Shift+Tab în titlu rămâne navigare', { key: 'Tab', shift: true }, null],
    ['Enter în descriere e rând nou', { key: 'Enter', field: 'desc' }, null],
    ['Ctrl+Enter în descriere salvează', { key: 'Enter', field: 'desc', mod: true }, 'submit'],
    ['Shift+Tab în descriere: înapoi la titlu', { key: 'Tab', shift: true, field: 'desc', descEmpty: false }, 'to-title'],
    ['Backspace pe descriere goală: înapoi la titlu', { key: 'Backspace', field: 'desc' }, 'to-title'],
    ['Backspace pe descriere scrisă șterge', { key: 'Backspace', field: 'desc', descEmpty: false }, null],
    ['Tab în descriere rămâne navigare', { key: 'Tab', field: 'desc' }, null],
  ] as const)('%s', (_, over, want) => {
    expect(k(over)).toBe(want)
  })
})

describe('keyboardInset', () => {
  it('WebView micșorat la tastatură: 0', () => {
    expect(keyboardInset(500, { height: 500, offsetTop: 0 })).toBe(0)
  })
  it('fereastra nu se micșorează: exact tastatura', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336)
  })
  it('vizorul derulat (iOS) scade din decalaj', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 40 })).toBe(296)
  })
  it('niciodată negativ', () => {
    expect(keyboardInset(800, { height: 820, offsetTop: 0 })).toBe(0)
  })
})

describe('un singur titlu de captură', () => {
  // Oglinda care desenează data e ușor de stricat (orice diferență de font sau
  // spațiere între straturi decalează marcajul) — deci există o singură dată.
  it.each([['QuickAdd', quickAddSrc], ['QuickSheet', quickSheetSrc]])('%s folosește QuickTitle, nu o oglindă proprie', (_, src) => {
    expect(src).toMatch(/import \{[^}]*\bQuickTitle\b[^}]*\} from '\.\/QuickFields'/)
    expect(src).toContain('<QuickTitle')
    expect(src).not.toContain('qa-mirror')
  })
})

describe('dueLabel', () => {
  const now = new Date(2026, 9, 3, 9, 0)
  it('azi și mâine în cuvinte, cu ora separată', () => {
    expect(dueLabelParts(new Date(2026, 9, 4, 10, 0).toISOString(), false, now)).toEqual({ day: 'Mâine', time: '10:00' })
    expect(dueLabel(new Date(2026, 9, 3).toISOString(), true, now)).toBe('Azi')
  })
  it('anul curent nu se scrie — pe rândul îngust lua locul proiectului', () => {
    expect(dueLabel(new Date(2026, 9, 7, 10, 0).toISOString(), false, now)).toBe('Mie 07/10 10:00')
  })
  it('alt an se scrie', () => {
    expect(dueLabel(new Date(2027, 0, 5).toISOString(), true, now)).toBe('Mar 05/01/2027')
  })
})

describe('captureDefaultProjectId — unde cade o sarcină fără proiect ales', () => {
  const projects = [
    { id: 'home', name: 'Home' },
    { id: 'd', name: 'Inbox' },
    { id: 'kata', name: 'Katalist' },
  ]
  it('dintr-o listă: Inbox, niciodată ultimul folosit', () => {
    expect(captureDefaultProjectId(LIST, projects)).toBe('d')
  })
  it('dintr-un proiect deschis: acela', () => {
    expect(captureDefaultProjectId(PROJ, projects)).toBe('p1')
  })
  it('Inbox după numele vechi, fără rândul `d`', () => {
    expect(captureDefaultProjectId(LIST, [{ id: 'h', name: 'Home' }, { id: 'x', name: '✅Daily' }])).toBe('x')
  })
  it('fără Inbox (sau fără drept de scriere în el, deci absent din listă): null, iar computeDraft alege', () => {
    expect(captureDefaultProjectId(LIST, [{ id: 'home', name: 'Home' }])).toBeNull()
  })
})

describe('seriesDueLabel — butonul de dată al barei spune seria', () => {
  const now = new Date(2026, 10, 9, 9, 20)
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
  const base = { allDay: false, rrule: null as string | null }
  it('azi: fără zi, doar pasul și fereastra', () => {
    expect(seriesDueLabel({ ...base, pingEvery: 60, remindAt: at(9, 9, 20), dueAt: at(9, 16) }, now)).toBe('Din oră în oră · primul 09:20 · până la 16:00')
  })
  it('altă zi: ziua în față', () => {
    expect(seriesDueLabel({ ...base, pingEvery: 15, remindAt: at(10, 9), dueAt: at(10, 10) }, now)).toBe('Mâine · la 15 min, la fix · primul 09:00 · până la 10:00')
  })
  it('recurentă: zilele la coadă', () => {
    expect(seriesDueLabel({ ...base, rrule: 'FREQ=DAILY', pingEvery: 60, remindAt: at(9, 9, 20), dueAt: at(9, 16) }, now)).toBe('Din oră în oră · primul 09:20 · până la 16:00 · zilnic')
  })
  it('„de la 10:48" scris la 11:05: primul e cel care chiar sună (11:48), nu ancora trecută', () => {
    expect(seriesDueLabel({ ...base, pingEvery: 60, remindAt: at(9, 10, 48), dueAt: at(9, 16) }, new Date(2026, 10, 9, 11, 5))).toBe('Din oră în oră · primul 11:48 · până la 16:00')
  })
  it('la fix: în regulă, înaintea primului', () => {
    expect(seriesDueLabel({ ...base, pingEvery: 60, remindAt: at(9, 10), dueAt: at(9, 16) }, now)).toBe('Din oră în oră, la fix · primul 10:00 · până la 16:00')
  })
  it('fără serie: gol (butonul rămâne „Azi 16:00" + clopoțel)', () => {
    expect(seriesDueLabel({ ...base, pingEvery: null, remindAt: at(9, 15, 45), dueAt: at(9, 16) }, now)).toBe('')
    expect(seriesDueLabel({ ...base, pingEvery: 60, remindAt: null, dueAt: null }, now)).toBe('')
  })
})

it('bara de captură: butonul de dată spune seria (`seriesDueLabel`), nu doar în tooltip', () => {
  expect(quickAddSrc).toMatch(/seriesDueLabel\(schedule/)
  expect(quickAddSrc).toMatch(/<span className="qs-due-t">\{seriesText\}<\/span>/)
})
