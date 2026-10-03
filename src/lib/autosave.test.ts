import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosaver, patchOf, rebase, type Normalize } from './autosave'

type F = { title: string; desc: string; urgent: boolean; dueAt: string | null }
const BASE: F = { title: 'Sună la bancă', desc: '', urgent: false, dueAt: null }
const trimTitle: Normalize<F> = (k, v) => {
  if (k !== 'title') return v
  const t = (v as string).trim()
  return (t === '' ? undefined : t) as typeof v | undefined
}

describe('patchOf', () => {
  it('trimite doar câmpurile schimbate', () => {
    expect(patchOf({ ...BASE, desc: 'x' }, BASE)).toEqual({ desc: 'x' })
  })
  it('nimic schimbat → patch gol', () => {
    expect(patchOf({ ...BASE }, BASE)).toEqual({})
  })
  it('null e o valoare: golirea scadenței pleacă', () => {
    expect(patchOf({ ...BASE, dueAt: null }, { ...BASE, dueAt: '2026-10-04T07:00:00.000Z' })).toEqual({ dueAt: null })
  })
  it('titlul se compară și se trimite fără spațiile de la capete', () => {
    expect(patchOf({ ...BASE, title: 'Sună la bancă ' }, BASE, trimTitle)).toEqual({})
    expect(patchOf({ ...BASE, title: ' Sună mâine ' }, BASE, trimTitle)).toEqual({ title: 'Sună mâine' })
  })
  it('un titlu golit nu pleacă', () => {
    expect(patchOf({ ...BASE, title: '  ', desc: 'd' }, BASE, trimTitle)).toEqual({ desc: 'd' })
  })
})

describe('rebase', () => {
  const none = new Set<keyof F>()
  it('un câmp curat adoptă valoarea nouă din bază', () => {
    const r = rebase(BASE, BASE, { ...BASE, dueAt: 'X' }, none)
    expect(r.draft.dueAt).toBe('X')
    expect(r.base.dueAt).toBe('X')
  })
  it('un câmp murdar rămâne cum l-ai scris, dar baza avansează', () => {
    const r = rebase({ ...BASE, desc: 'scriu' }, BASE, { ...BASE, desc: 'de pe alt telefon' }, none)
    expect(r.draft.desc).toBe('scriu')
    expect(r.base.desc).toBe('de pe alt telefon')
  })
  it('o poză identică nu atinge ciorna (spațiul de la capătul titlului rămâne)', () => {
    const draft = { ...BASE, title: 'Sună la bancă ' }
    const r = rebase(draft, BASE, { ...BASE }, none, trimTitle)
    expect(r.draft.title).toBe('Sună la bancă ')
  })
  it('un câmp în zbor nu se rescrie cu o poză mai veche', () => {
    const r = rebase({ ...BASE, title: 'nou' }, { ...BASE, title: 'nou' }, { ...BASE, title: 'vechi' }, new Set<keyof F>(['title']))
    expect(r.draft.title).toBe('nou')
    expect(r.base.title).toBe('nou')
  })
})

describe('Autosaver', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const make = (save = vi.fn(async (_p: Partial<F>) => {})) => ({ save, s: new Autosaver<F>({ initial: BASE, save, delay: 800, normalize: trimTitle }) })

  it('textul pleacă o singură dată, după pauză, cu ultima valoare', async () => {
    const { save, s } = make()
    s.set({ desc: 'a' }, 'debounce')
    await vi.advanceTimersByTimeAsync(500)
    s.set({ desc: 'ab' }, 'debounce')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ desc: 'ab' })
  })

  it('un jeton pleacă imediat și ia cu el textul care aștepta', async () => {
    const { save, s } = make()
    s.set({ desc: 'scris' }, 'debounce')
    await s.set({ urgent: true }, 'now')
    expect(save).toHaveBeenCalledWith({ desc: 'scris', urgent: true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush fără modificări nu trimite nimic', async () => {
    const { save, s } = make()
    expect(await s.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('ce se tastează cât e salvarea în zbor pleacă separat, fără ce a plecat deja', async () => {
    let release!: () => void
    const save = vi.fn((_p: Partial<F>) => new Promise<void>((r) => { release = r }))
    const s = new Autosaver<F>({ initial: BASE, save, normalize: trimTitle })
    const first = s.set({ title: 'Sună' }, 'now')
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledWith({ title: 'Sună' })
    s.set({ desc: 'x' }, 'debounce')
    const second = s.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await first
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenLastCalledWith({ desc: 'x' })
    release()
    await second
    expect(s.status).toBe('idle')
  })

  it('o salvare eșuată lasă ciorna murdară, iar următoarea o reîncearcă', async () => {
    const save = vi.fn<(p: Partial<F>) => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue()
    const s = new Autosaver<F>({ initial: BASE, save })
    expect(await s.set({ urgent: true }, 'now')).toBe(false)
    expect(s.status).toBe('error')
    expect(s.pending()).toEqual({ urgent: true })
    expect(await s.flush()).toBe(true)
    expect(save).toHaveBeenLastCalledWith({ urgent: true })
    expect(s.status).toBe('idle')
  })

  it('saltul recurenței venit din store se vede fără să fie trimis înapoi', async () => {
    const { save, s } = make()
    s.receive({ ...BASE, dueAt: '2026-10-05T07:00:00.000Z' })
    expect(s.draft.dueAt).toBe('2026-10-05T07:00:00.000Z')
    expect(s.pending()).toEqual({})
    await s.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('poza venită cât e titlul în zbor nu-l calcă', async () => {
    let release!: () => void
    const save = vi.fn((_p: Partial<F>) => new Promise<void>((r) => { release = r }))
    const s = new Autosaver<F>({ initial: BASE, save })
    const p = s.set({ title: 'Nou' }, 'now')
    await vi.advanceTimersByTimeAsync(0)
    s.receive({ ...BASE }) // o reîmprospătare cu titlul vechi
    expect(s.draft.title).toBe('Nou')
    release()
    await p
    s.receive({ ...BASE, title: 'Nou' })
    expect(s.draft.title).toBe('Nou')
    expect(s.pending()).toEqual({})
  })
})
