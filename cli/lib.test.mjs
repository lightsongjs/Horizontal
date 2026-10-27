import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseArgs, UsageError, configPath, resolveConfig, findProjectFile, contextProject,
  matchProject, withClaudeImport, buildCreateBody, buildUpdateBody, ticketLine, ticketingMd,
  fold, rankProjects, pickerItems, pickerStart, pickerKey, pickerView, NEW_PROJECT,
  suggestPrefix, cleanPrefix, prefixOwner, defaultProjectType, parseProjectType, buildProjectBody,
  buildCommentBody, commentHasContent, commentLines, localTime, authorFor, pickMe, COMMANDS,
} from './lib.mjs'
import * as app from '../src/lib/newProject'

describe('parseArgs', () => {
  it('comandă, pozițional și flaguri', () => {
    expect(parseArgs(['create', 'Auth', 'flow', '--deps', 'A-1,A-2', '--urgent'])).toEqual({
      cmd: 'create', positional: ['Auth', 'flow'], flags: { deps: 'A-1,A-2', urgent: true },
    })
  })
  it('forma veche din ai-client: --create devine comanda', () => {
    const p = parseArgs(['--create', '--project', 'kata', '--title', 'X', '--wave', '1', '--urgent', 'true'])
    expect(p.cmd).toBe('create')
    expect(p.flags).toEqual({ project: 'kata', title: 'X', wave: '1', urgent: true })
  })
  it('aliasurile vechi de comenzi', () => {
    expect(parseArgs(['--create-theme', '--name', 'N']).cmd).toBe('theme-create')
    expect(parseArgs(['ls']).cmd).toBe('list')
    expect(parseArgs(['update-wave', '2']).cmd).toBe('wave-update')
  })
  it('șirul gol e o valoare (golește), nu o lipsă', () => {
    expect(parseArgs(['update', 'A-1', '--deps', '']).flags.deps).toBe('')
  })
  it('--a=b și --file repetat', () => {
    const p = parseArgs(['attach', '--id=A-1', '--file', 'a.png', '--file', 'b.png'])
    expect(p.flags).toEqual({ id: 'A-1', file: ['a.png', 'b.png'] })
  })
  it('booleene: false explicit și refuzul altor valori', () => {
    expect(parseArgs(['update', 'A-1', '--done', 'false']).flags.done).toBe(false)
    expect(parseArgs(['update', 'A-1', '--done', 'X']).positional).toEqual(['A-1', 'X'])
    expect(() => parseArgs(['update', '--urgent=da'])).toThrow(UsageError)
  })
  it('un flag de valoare fără valoare e o eroare', () => {
    expect(() => parseArgs(['create', 'X', '--deps'])).toThrow(UsageError)
    expect(() => parseArgs(['create', 'X', '--deps', '--urgent'])).toThrow(UsageError)
  })
  it('fără comandă: null; --help → help', () => {
    expect(parseArgs([]).cmd).toBe(null)
    expect(parseArgs(['--help']).cmd).toBe('help')
    expect(parseArgs(['frobnicate']).positional).toEqual(['frobnicate'])
  })
})

describe('configurația', () => {
  it('XDG_CONFIG_HOME bate ~/.config', () => {
    expect(configPath({}, '/h')).toBe('/h/.config/horizontal/config.json')
    expect(configPath({ XDG_CONFIG_HOME: '/x' }, '/h')).toBe('/x/horizontal/config.json')
  })
  it('mediul bate fișierul, câmp cu câmp', () => {
    const file = { apiUrl: 'https://f.dev/', apiKey: 'kf' }
    expect(resolveConfig({}, file)).toMatchObject({ apiUrl: 'https://f.dev', apiKey: 'kf', source: { apiUrl: 'file', apiKey: 'file' } })
    expect(resolveConfig({ HORIZONTAL_API_KEY: 'ke' }, file)).toMatchObject({ apiUrl: 'https://f.dev', apiKey: 'ke', source: { apiKey: 'env' } })
    expect(resolveConfig({ HORIZONTAL_API_URL: 'http://e' }, null)).toMatchObject({ apiUrl: 'http://e', apiKey: '' })
  })
})

describe('.horizontal', () => {
  const fs = { existsSync, readFileSync }
  it('se găsește urcând din subdirectoare', () => {
    const root = mkdtempSync(join(tmpdir(), 'tk-'))
    writeFileSync(join(root, '.horizontal'), '{"project":"kata"}')
    const deep = join(root, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    expect(findProjectFile(deep, fs)).toEqual({ path: join(root, '.horizontal'), dir: root, project: 'kata' })
  })
  it('lipsă → null; stricat → UsageError', () => {
    const root = mkdtempSync(join(tmpdir(), 'tk-'))
    // tmpdir poate avea un .horizontal mai sus doar în teorie; tăiem căutarea la fs-ul fals
    expect(findProjectFile(root, { existsSync: () => false, readFileSync })).toBe(null)
    writeFileSync(join(root, '.horizontal'), 'nu e json')
    expect(() => findProjectFile(root, fs)).toThrow(UsageError)
  })
  it('--project bate fișierul', () => {
    expect(contextProject({ project: 'x' }, { project: 'kata' })).toBe('x')
    expect(contextProject({}, { project: 'kata' })).toBe('kata')
    expect(contextProject({}, null)).toBe(null)
  })
  it('matchProject: id, prefix, nume', () => {
    const list = [{ id: 'kata', prefix: 'KATA', name: 'Katalist' }, { id: 'h', prefix: 'HZ', name: 'Horizontal' }]
    expect(matchProject(list, 'KATA').id).toBe('kata')
    expect(matchProject(list, 'hz').id).toBe('h')
    expect(matchProject(list, 'horizontal').id).toBe('h')
    expect(matchProject(list, 'nu')).toBe(null)
  })
})

describe('CLAUDE.md', () => {
  it('se creează când lipsește', () => {
    expect(withClaudeImport(null)).toBe('@TICKETING.md\n')
  })
  it('se adaugă la coadă, cu un rând gol înainte când lipsește \\n final', () => {
    expect(withClaudeImport('# P\n')).toBe('# P\n\n@TICKETING.md\n')
    expect(withClaudeImport('# P')).toBe('# P\n\n@TICKETING.md\n')
  })
  it('idempotent: a doua oară nu schimbă nimic', () => {
    const once = withClaudeImport('# P\n')
    expect(withClaudeImport(once)).toBe(null)
    expect(withClaudeImport('a\r\n  @TICKETING.md  \r\nb')).toBe(null)
  })
  it('o mențiune în text nu contează ca import', () => {
    expect(withClaudeImport('vezi @TICKETING.md mai jos\n')).not.toBe(null)
  })
})

describe('corpurile cererilor', () => {
  it('create: deps, due, urgent, assignee', () => {
    expect(buildCreateBody({ projectId: 'kata', title: 'T', wave: '2', flags: { deps: 'A-1, A-2', due: '2026-10-24', urgent: true, assignee: 'Ionut' } }))
      .toEqual({ projectId: 'kata', title: 'T', wave: 2, deps: ['A-1', 'A-2'], desc: '', notes: '', assigneeId: 'Ionut', due: '2026-10-24', urgent: true })
  })
  it('create: fără titlu sau cu val greșit → UsageError', () => {
    expect(() => buildCreateBody({ projectId: 'k', title: '', wave: 1, flags: {} })).toThrow(UsageError)
    expect(() => buildCreateBody({ projectId: 'k', title: 'T', wave: 'x', flags: {} })).toThrow(UsageError)
  })
  it('update: numai câmpurile date; golirile', () => {
    expect(buildUpdateBody({ deps: '', assignee: '', due: '', done: true })).toEqual({ deps: [], assigneeId: null, due: '', done: true })
    expect(buildUpdateBody({ project: 'tk' })).toEqual({ projectId: 'tk' })
    expect(buildUpdateBody({ 'move-to': 'tk', wave: '2' })).toEqual({ projectId: 'tk', wave: 2 })
    expect(buildUpdateBody({ selectors: '["a"]' })).toEqual({ selectors: ['a'] })
  })
  it('update: nimic de schimbat sau JSON stricat → UsageError', () => {
    expect(() => buildUpdateBody({})).toThrow(UsageError)
    expect(() => buildUpdateBody({ scenarios: '[' })).toThrow(UsageError)
  })
})

describe('afișarea', () => {
  it('rândul din list, ca în ai-client', () => {
    expect(ticketLine({ id: 'K-1', wave: 1, done: true, theme: 'auth', title: 'T', deps: ['K-0'], dueAt: 'D', urgent: true }, 'I / MVP'))
      .toBe('K-1  [wave 1 · I / MVP] ✓  #auth  T  ← K-0  (due D)  !')
  })
  it('TICKETING.md e scurt și trimite la tk guide', () => {
    const md = ticketingMd({ id: 'kata', prefix: 'KATA', name: 'Katalist' })
    expect(md).toContain('tk guide')
    expect(md).toContain('`kata`')
    expect(md.split('\n').length).toBeLessThan(20)
  })
})

describe('alegerea proiectului (tk init fără argument)', () => {
  const list = [
    { id: 'apo', prefix: 'APO', name: 'Apostila' },
    { id: 'kata', prefix: 'KATA', name: 'Katalist' },
    { id: 'tr', prefix: 'TR', name: 'Turul României' },
    { id: 'horizontal', prefix: 'HZ', name: 'Horizontal' },
  ]
  const ids = (xs) => xs.map((p) => p.id)

  it('fold: fără diacritice (și ș/ț cu virgulă), fără majuscule', () => {
    expect(fold('Știri ȚARĂ șî')).toBe('stiri tara si')
  })
  it('rank: exact pe id/prefix, apoi început, apoi început de cuvânt, apoi oriunde', () => {
    expect(ids(rankProjects(list, ''))).toEqual(['apo', 'kata', 'tr', 'horizontal'])
    expect(ids(rankProjects(list, 'hz'))).toEqual(['horizontal'])
    expect(ids(rankProjects(list, 'ROM'))).toEqual(['tr'])
    expect(ids(rankProjects(list, 'romaniei'))).toEqual(['tr'])
    expect(ids(rankProjects(list, 'ta'))).toEqual(['kata', 'horizontal']) // „kaTA”, „horizonTAl”: oriunde, în ordinea listei
    expect(ids(rankProjects(list, 'tr'))).toEqual(['tr'])
    expect(ids(rankProjects(list, 'a'))).toEqual(['apo', 'kata', 'tr', 'horizontal'])
    expect(rankProjects(list, 'zzz')).toEqual([])
  })
  it('„+ Proiect nou…” e mereu ultimul; cifrele nu filtrează', () => {
    expect(pickerItems(list, 'zzz')).toEqual([NEW_PROJECT])
    expect(pickerItems(list, '3')).toHaveLength(5)
  })
  it('tastele: scrisul filtrează, săgețile se rotesc, Enter alege, Esc renunță', () => {
    let st = pickerStart()
    for (const char of 'kat') st = pickerKey(list, st, { char }).state
    expect(st).toEqual({ query: 'kat', index: 0 })
    expect(pickerKey(list, st, { name: 'return' }).choice.id).toBe('kata')
    st = pickerKey(list, st, { name: 'down' }).state
    expect(pickerKey(list, st, { name: 'return' }).choice).toBe(NEW_PROJECT)
    st = pickerKey(list, st, { name: 'down' }).state // se rotește
    expect(st.index).toBe(0)
    st = pickerKey(list, st, { name: 'up' }).state
    expect(st.index).toBe(1)
    st = pickerKey(list, st, { name: 'backspace' }).state
    expect(st).toEqual({ query: 'ka', index: 0 })
    expect(pickerKey(list, st, { name: 'escape' })).toMatchObject({ done: true, choice: null })
    expect(pickerKey(list, st, { name: 'abort' })).toMatchObject({ done: true, choice: null })
  })
  it('cifrele aleg rândul: 3 = al treilea, 5 = proiect nou, 9 = în afara listei → primul', () => {
    const pick = (q) => { let st = pickerStart(); for (const char of q) st = pickerKey(list, st, { char }).state; return pickerKey(list, st, { name: 'return' }).choice }
    expect(pick('3').id).toBe('tr')
    expect(pick('5')).toBe(NEW_PROJECT)
    expect(pick('9').id).toBe('apo')
  })
  it('desenul: numerotat, rândul ales marcat, fereastră în jurul lui', () => {
    const v = pickerView(list, { query: '', index: 1 })
    expect(v.rows.map((r) => r.text)).toEqual([
      '1  apo  APO  Apostila  [personal]',
      '2  kata  KATA  Katalist  [personal]',
      '3  tr  TR  Turul României  [personal]',
      '4  horizontal  HZ  Horizontal  [personal]',
      '5  + Proiect nou…',
    ])
    expect(v.rows[1].selected).toBe(true)
    expect(v.matches).toBe(4)
    const small = pickerView(list, { query: '', index: 4 }, 2)
    expect(small.rows.map((r) => r.text)).toEqual(['4  horizontal  HZ  Horizontal  [personal]', '5  + Proiect nou…'])
    expect(small.hint).toContain('încă 3')
  })
})

describe('proiectul nou din CLI', () => {
  it('prefixul sugerat e cel al formularului din aplicație', () => {
    for (const n of ['Turul României', 'Horizontal', 'a b c d e f g', '  x-y z ', '123 abc', 'Știri noi']) {
      expect(suggestPrefix(n)).toBe(app.cleanPrefix(app.autoPrefix(n)))
      expect(cleanPrefix(n)).toBe(app.cleanPrefix(n))
    }
  })
  it('…iar unde aplicația ar da gol, numele fără diacritice', () => {
    expect(app.cleanPrefix(app.autoPrefix('Știri'))).toBe('')
    expect(suggestPrefix('Știri')).toBe('S')
  })
  it('prefixOwner e cel al aplicației', () => {
    const list = [{ id: 'horizontal', prefix: 'HZ', name: 'H' }, { id: 'tur', prefix: 'XX', name: 'T' }]
    for (const p of ['hz', 'TUR', 'xx', 'nou', '']) expect(prefixOwner(list, p)).toEqual(app.prefixOwner(list, p))
  })
  it('tipul implicit: work numai sub ~/01Projects/Work', () => {
    expect(defaultProjectType('/home/j/01Projects/Work', '/home/j')).toBe('work')
    expect(defaultProjectType('/home/j/01Projects/Work/smartbill/api', '/home/j')).toBe('work')
    expect(defaultProjectType('/home/j/01Projects/Workshop', '/home/j')).toBe('personal')
    expect(defaultProjectType('/home/j/01Projects/personal/Horizontal', '/home/j')).toBe('personal')
  })
  it('răspunsul la „Tip”', () => {
    expect(parseProjectType('', 'work')).toBe('work')
    expect(parseProjectType('P', 'work')).toBe('personal')
    expect(parseProjectType('serviciu', 'personal')).toBe('work')
    expect(parseProjectType('job', 'work')).toBe(null)
  })
  it('project-create: corpul; prefixul curățat; refuzurile', () => {
    expect(buildProjectBody(['Turul', 'X'], { prefix: 'tu-r', type: 'work' })).toEqual({ name: 'Turul X', prefix: 'TUR', type: 'work' })
    expect(buildProjectBody([], { name: 'N', desc: 'd', accent: '#ffb454' })).toEqual({ name: 'N', description: 'd', accent: '#ffb454' })
    expect(() => buildProjectBody([], {})).toThrow(UsageError)
    expect(() => buildProjectBody(['N'], { prefix: 'ăî' })).toThrow(UsageError)
    expect(() => buildProjectBody(['N'], { type: 'job' })).toThrow(UsageError)
    expect(parseArgs(['create-project', 'N']).cmd).toBe('project-create')
  })
})

describe('firul (tk comments / tk comment)', () => {
  it('comenzile există; thread = comments', () => {
    expect(COMMANDS).toEqual(expect.arrayContaining(['comments', 'comment', 'whoami']))
    expect(parseArgs(['thread', 'H-7']).cmd).toBe('comments')
    expect(parseArgs(['me']).cmd).toBe('whoami')
  })

  it('--attach se repetă; --to "" e o valoare (înapoi la creator)', () => {
    const { cmd, positional, flags } = parseArgs(['comment', 'H-7', 'gata', '--attach', 'a.png', '--attach', 'b.pdf', '--to', ''])
    expect(cmd).toBe('comment')
    expect(positional).toEqual(['H-7', 'gata'])
    expect(flags).toEqual({ attach: ['a.png', 'b.pdf'], to: '' })
  })

  it('corpul: autorul obligatoriu; to numai dacă e dat; fișierele după urcare', () => {
    expect(buildCommentBody('gata', {}, 'Ionut')).toEqual({ author: 'Ionut', body: 'gata' })
    expect(buildCommentBody('ia-l', { to: 'Ana' }, 'Ionut', ['f1'])).toEqual({ author: 'Ionut', body: 'ia-l', to: 'Ana', attachmentIds: ['f1'] })
    expect(buildCommentBody('', { to: '' }, 'Ionut')).toEqual({ author: 'Ionut', body: '', to: '' })
    expect(() => buildCommentBody('x', {}, null)).toThrow(/tk whoami --set/)
  })

  it('are ce scrie: text, fișiere sau o pasă', () => {
    expect(commentHasContent('  ', {})).toBe(false)
    expect(commentHasContent('x', {})).toBe(true)
    expect(commentHasContent('', { attach: ['a'] })).toBe(true)
    expect(commentHasContent('', { to: '' })).toBe(true)
  })

  it('ora României, fără secunde', () => {
    expect(localTime('2026-10-27T12:32:10Z')).toBe('2026-10-27 14:32')
    expect(localTime('2026-07-01T12:00:00Z')).toBe('2026-07-01 15:00')
  })

  it('rândurile: comentariu (editat, corp indentat, fișiere) și pasă', () => {
    expect(commentLines({
      kind: 'comment', author: 'Ionut', createdAt: '2026-10-27T12:32:00Z', editedAt: '2026-10-27T12:40:00Z',
      body: 'unu\ndoi', attachments: [{ id: 'f1', filename: 'a.png', size: 3, url: 'https://s/f1' }],
    })).toEqual([
      '2026-10-27 14:32  Ionut  (editat)', '    unu', '    doi', '    fișier: f1  a.png  3  https://s/f1',
    ])
    expect(commentLines({
      kind: 'handoff', author: 'Ionut', createdAt: '2026-10-27T12:32:00Z', body: '',
      handoff: { from: null, to: { id: 'a', name: 'Ana' } }, attachments: [],
    })).toEqual(['2026-10-27 14:32  Ionut  pasă: creator → Ana'])
  })
})

describe('cine scrie (tk whoami)', () => {
  it('config: HORIZONTAL_ME bate fișierul', () => {
    const file = { apiUrl: 'https://f', apiKey: 'k', me: { id: 'a-ion', name: 'Ionut' } }
    expect(resolveConfig({}, file)).toMatchObject({ me: { id: 'a-ion', name: 'Ionut' }, source: { me: 'file' } })
    expect(resolveConfig({ HORIZONTAL_ME: 'Ana' }, file)).toMatchObject({ me: { id: 'Ana' }, source: { me: 'env' } })
    expect(resolveConfig({}, { apiUrl: 'x' }).me).toBeNull()
  })

  it('--as bate omul configurat; --as "" = nimeni', () => {
    const cfg = { me: { id: 'a-ion', name: 'Ionut' } }
    expect(authorFor({}, cfg)).toBe('a-ion')
    expect(authorFor({ as: 'Ana' }, cfg)).toBe('Ana')
    expect(authorFor({ as: '' }, cfg)).toBeNull()
    expect(authorFor({}, { me: null })).toBeNull()
  })

  it('alege după nume (fără diacritice/majuscule) sau id; numai un om cu cont', () => {
    const list = [{ id: 'a-ion', name: 'Ionuț', linked: true }, { id: 'a-ana', name: 'Ana', linked: false }]
    expect(pickMe(list, 'ionut')).toEqual({ me: { id: 'a-ion', name: 'Ionuț' } })
    expect(pickMe(list, 'a-ion')).toEqual({ me: { id: 'a-ion', name: 'Ionuț' } })
    expect(pickMe(list, 'Ana')).toMatchObject({ error: 'author_not_linked' })
    expect(pickMe(list, 'Zoe')).toEqual({ error: 'author_not_found' })
  })

  it('create trimite autorul doar dacă e; update --pin', () => {
    expect(buildCreateBody({ projectId: 'k', title: 'T', wave: 1, flags: {}, author: 'a-ion' }).author).toBe('a-ion')
    expect(buildCreateBody({ projectId: 'k', title: 'T', wave: 1, flags: {} })).not.toHaveProperty('author')
    expect(buildUpdateBody({ pin: true })).toEqual({ pinned: true })
    expect(parseArgs(['update', 'H-7', '--pin', 'false']).flags).toEqual({ pin: false })
  })
})
