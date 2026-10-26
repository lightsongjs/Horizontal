import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseArgs, UsageError, configPath, resolveConfig, findProjectFile, contextProject,
  matchProject, withClaudeImport, buildCreateBody, buildUpdateBody, ticketLine, ticketingMd,
} from './lib.mjs'

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
