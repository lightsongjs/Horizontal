import { describe, expect, it } from 'vitest'
import {
  activeBindings, continuations, EMPTY_SEQ, expire, feed, isTypingTarget, KEYMAP, pendingLabel,
  SEQ_TIMEOUT_MS, splitSeq, token, type Binding, type FeedOptions, type KeyLike, type SeqState,
} from './keymap'

describe('token', () => {
  // [nume, eveniment, token]
  const cases: [string, KeyLike, string | null][] = [
    ['literă', { key: 'j', code: 'KeyJ' }, 'j'],
    ['Shift+literă', { key: 'J', code: 'KeyJ', shiftKey: true }, 'J'],
    ['Enter', { key: 'Enter', code: 'Enter' }, 'Enter'],
    ['spațiu', { key: ' ', code: 'Space' }, 'Space'],
    ['Escape', { key: 'Escape', code: 'Escape' }, 'Escape'],
    ['săgeată', { key: 'ArrowDown', code: 'ArrowDown' }, 'ArrowDown'],
    ['cifră', { key: '5', code: 'Digit5' }, '5'],
    ['US: două puncte', { key: ':', code: 'Semicolon', shiftKey: true }, ':'],
    ['US: virgulă', { key: ',', code: 'Comma' }, ','],
    // RO standard: tastele scriu diacritice; tokenul e după poziție.
    ['RO: ș → ;', { key: 'ș', code: 'Semicolon' }, ';'],
    ['RO: Shift+ș → :', { key: 'Ș', code: 'Semicolon', shiftKey: true }, ':'],
    ['RO: ă → [', { key: 'ă', code: 'BracketLeft' }, '['],
    ['RO: î → ]', { key: 'î', code: 'BracketRight' }, ']'],
    ['RO: ț → \'', { key: 'ț', code: 'Quote' }, "'"],
    ['RO: â → \\', { key: 'â', code: 'Backslash' }, '\\'],
    ['tastă moartă pe poziția lui /', { key: 'Dead', code: 'Slash', shiftKey: true }, '?'],
    ['Shift singur', { key: 'Shift', code: 'ShiftLeft', shiftKey: true }, null],
    ['Tab', { key: 'Tab', code: 'Tab' }, null],
    ['diacritică fără poziție cunoscută', { key: 'ö', code: 'KeyO' }, null],
  ]
  for (const [name, e, want] of cases) it(name, () => expect(token(e)).toBe(want))
})

describe('splitSeq', () => {
  it('nume de tastă = un token, restul pe caractere', () => {
    expect(splitSeq('Enter')).toEqual(['Enter'])
    expect(splitSeq('ArrowDown')).toEqual(['ArrowDown'])
    expect(splitSeq('gg')).toEqual(['g', 'g'])
    expect(splitSeq('g,')).toEqual(['g', ','])
  })
})

/** Rulează o secvență de tokeni, cu timpi, și întoarce ce a pornit. */
function run(toks: (string | { t: string; at: number })[], opts: Partial<FeedOptions> = {}) {
  let s: SeqState = EMPTY_SEQ
  const fired: string[] = []
  const results: string[] = []
  let now = 1000
  for (const x of toks) {
    const tok = typeof x === 'string' ? x : x.t
    now = typeof x === 'string' ? now + 10 : x.at
    const r = feed(s, tok, { ctx: 'list', now, allowCount: true, ...opts })
    s = r.state
    results.push(r.result.kind)
    if (r.result.kind === 'fire') fired.push(`${r.result.binding.id}${r.result.count > 1 ? `×${r.result.count}` : ''}`)
  }
  return { s, fired, results }
}

describe('feed', () => {
  const cases: [string, (string | { t: string; at: number })[], Partial<FeedOptions>, string[]][] = [
    ['j pleacă imediat', ['j'], {}, ['down']],
    ['gg = primul rând', ['g', 'g'], {}, ['first']],
    ['gt = Azi (today, global, din listă)', ['g', 't'], {}, ['goToday']],
    ['gm = Ale mele (mine)', ['g', 'm'], {}, ['goMine']],
    ['/ = căutarea globală', ['/'], {}, ['search']],
    ['5j = numărătoare pe mișcare', ['5', 'j'], {}, ['down×5']],
    ['12j = numărătoare de două cifre', ['1', '2', 'j'], {}, ['down×12']],
    ['numărătoarea nu se aplică unei non-mișcări', ['3', 'G'], {}, ['last']],
    ['fără numărători (alt context), cifra nu e a noastră', ['5', 'j'], { allowCount: false }, ['down']],
    ['g, = setări', ['g', ','], {}, ['settings']],
    ['O = căutarea', ['O'], {}, ['search']],
    ['h în listă → bara laterală', ['h'], {}, ['toSidebar']],
    ['h în panou → lista (localul bate)', ['h'], { ctx: 'panel' }, ['toList']],
    ['j în panou = câmpul următor', ['j'], { ctx: 'panel' }, ['fieldDown']],
    ['dd în listă = ștergere, D = mâine', ['d', 'd', 'D'], {}, ['delete', 'tomorrow']],
    ['] = valul următor, și din listă', [']'], {}, ['waveNext']],
    ['gv = foaia valurilor', ['g', 'v'], {}, ['waveManage']],
    ['i în panou = titlul, în listă nu e al nostru', ['i'], { ctx: 'panel' }, ['pTitle']],
    ['Space în listă = selecție', ['Space'], {}, ['mark']],
    ['m = meniul de acțiuni, în listă și în panou', ['m'], {}, ['menu']],
    ['m în panou = meniul (nu mai e comentariul)', ['m'], { ctx: 'panel' }, ['menu']],
    ['gc în panou = comentariul', ['g', 'c'], { ctx: 'panel' }, ['pComment']],
    ['J / K în panou = secțiunile', ['J', 'K'], { ctx: 'panel' }, ['sectionDown', 'sectionUp']],
    ['t în listă = sub-meniul datei', ['t'], {}, ['date']],
    ['fără context: doar globalele', ['g', 'w', 'j'], { ctx: null }, ['goWeek']],
    ['secvența expiră după timeout', ['g', { t: 'g', at: 1010 + SEQ_TIMEOUT_MS + 1 }], {}, []],
  ]
  for (const [name, toks, opts, want] of cases) it(name, () => expect(run(toks, opts).fired).toEqual(want))

  it('o tastă necunoscută cu secvența goală nu e a noastră', () => {
    expect(run(['q']).results).toEqual(['none'])
    expect(run(['i']).results).toEqual(['none'])
  })
  it('o secvență ruptă se înghite', () => {
    expect(run(['g', 'q']).results).toEqual(['pending', 'broken'])
  })
  it('o numărătoare urmată de o tastă străină o lasă să treacă', () => {
    const r = run(['5', 'q'])
    expect(r.results).toEqual(['pending', 'none'])
    expect(r.s).toEqual(EMPTY_SEQ)
  })
  it('0 singur nu e numărătoare, după o cifră e', () => {
    expect(run(['0']).results).toEqual(['none'])
    expect(run(['1', '0', 'j']).fired).toEqual(['down×10'])
  })
  it('prefixul ține starea și o arată', () => {
    const r = run(['2', 'g'])
    expect(r.results).toEqual(['pending', 'pending'])
    expect(pendingLabel(r.s)).toBe('2g…')
    expect(pendingLabel(run(['5']).s)).toBe('5')
    expect(pendingLabel(EMPTY_SEQ)).toBe('')
  })
})

describe('exact vs. mai lung (pornește la timeout)', () => {
  // Hartă de probă: `d` are exact și o continuare `dd`.
  const map: Binding[] = [
    { seq: ['d'], ctx: 'list', id: 'down', desc: 'd' },
    { seq: ['d', 'd'], ctx: 'list', id: 'last', desc: 'dd' },
  ]
  const opts = { ctx: 'list' as const, bindings: map }
  it('d așteaptă continuarea', () => {
    const r = feed(EMPTY_SEQ, 'd', { ...opts, now: 1, allowCount: true })
    expect(r.result.kind).toBe('pending')
    const e = expire(r.state, opts)
    expect(e.result.kind === 'fire' && e.result.binding.id).toBe('down')
    expect(e.state).toEqual(EMPTY_SEQ)
  })
  it('dd pleacă imediat', () => {
    const a = feed(EMPTY_SEQ, 'd', { ...opts, now: 1, allowCount: true })
    const r = feed(a.state, 'd', { ...opts, now: 2, allowCount: true })
    expect(r.result.kind === 'fire' && r.result.binding.id).toBe('last')
  })
  it('un prefix fără exact se uită la timeout', () => {
    const a = feed(EMPTY_SEQ, 'g', { ctx: 'list', now: 1, allowCount: true })
    expect(expire(a.state, { ctx: 'list' }).result.kind).toBe('none')
  })
})

describe('activeBindings / continuations', () => {
  it('localul bate globalul la aceeași secvență', () => {
    const map: Binding[] = [
      { seq: ['h'], ctx: 'any', id: 'historyBack', desc: 'global' },
      { seq: ['h'], ctx: 'list', id: 'toSidebar', desc: 'local' },
    ]
    expect(activeBindings('list', map).map((x) => x.id)).toEqual(['toSidebar'])
    expect(activeBindings('panel', map).map((x) => x.id)).toEqual(['historyBack'])
  })
  it('which-key: continuările lui g în listă, fără dubluri ascunse', () => {
    const s = feed(EMPTY_SEQ, 'g', { ctx: 'list', now: 1, allowCount: true }).state
    const rest = continuations(s, 'list').map((c) => c.rest)
    expect(rest).toEqual(expect.arrayContaining(['t', 'w', 'm', 'p', 's', ',', 'g']))
  })
  it('fiecare intrare are descriere și un context cunoscut', () => {
    for (const x of KEYMAP) {
      expect(x.desc.length).toBeGreaterThan(0)
      expect(['list', 'panel', 'sidebar', 'any']).toContain(x.ctx)
    }
  })
  it('nicio secvență dublată în același context', () => {
    const seen = new Set<string>()
    for (const x of KEYMAP) {
      const k = `${x.ctx}:${x.seq.join(' ')}`
      expect(seen.has(k), k).toBe(false)
      seen.add(k)
    }
  })
})

describe('isTypingTarget', () => {
  const el = (tag: string, props: Record<string, unknown> = {}) =>
    ({ tagName: tag, isContentEditable: false, closest: () => null, ...props }) as unknown as Element
  it('câmpurile de scris', () => {
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isTypingTarget(el('SPAN', { closest: (s: string) => (s === '.cm-editor' ? {} : null) }))).toBe(true)
  })
  it('restul nu', () => {
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('c mic vs. cc', () => {
  it('c singur nu mai creează (crearea e a); cc redenumește', () => {
    const a = feed(EMPTY_SEQ, 'c', { ctx: 'list', now: 1, allowCount: true })
    expect(a.result.kind).toBe('pending')
    const e = expire(a.state, { ctx: 'list' })
    expect(e.result.kind).not.toBe('fire')
    const b = feed(a.state, 'c', { ctx: 'list', now: 2, allowCount: true })
    expect(b.result.kind === 'fire' && b.result.binding.id).toBe('rename')
  })
  it('a creează', () => {
    const r = feed(EMPTY_SEQ, 'a', { ctx: 'list', now: 1, allowCount: true })
    expect(r.result.kind === 'fire' && r.result.binding.id).toBe('newTask')
  })
})
