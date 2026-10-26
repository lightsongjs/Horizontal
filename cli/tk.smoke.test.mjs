// Proba de fum: `tk` rulat ca proces, contra unui server HTTP fals pe localhost.
// Niciodată API-ul de producție: URL-ul și cheia vin din mediu, iar
// XDG_CONFIG_HOME e un director temporar (fișierul real de config nu se atinge).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, lstatSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HZ = join(HERE, 'tk.mjs')
const KEY = 'cheie-de-proba'

let server
let url
const seen = []

const PROJECTS = [{ id: 'kata', prefix: 'KATA', name: 'Katalist', type: 'work', currentWave: 3 }]

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      seen.push({ method: req.method, url: req.url, headers: req.headers, raw })
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.headers['x-api-key'] !== KEY) return send(401, { error: 'unauthorized' })
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/api/projects') return send(200, PROJECTS)
      if (u.pathname === '/api/waves') return send(200, [{ number: 1, name: 'I', label: 'MVP' }])
      if (u.pathname === '/api/tickets' && req.method === 'POST') {
        const body = JSON.parse(raw.toString())
        if (body.title === 'Dublura') return send(409, { error: 'duplicate_title', existing_id: 'KATA-02' })
        return send(201, { id: 'KATA-09' })
      }
      if (u.pathname === '/api/tickets' && req.method === 'GET') {
        return send(200, [
          { id: 'KATA-01', title: 'Schema', wave: 1, done: true, theme: null, deps: [] },
          { id: 'KATA-02', title: 'API', wave: 1, done: false, theme: 'auth', deps: ['KATA-01'], urgent: true },
        ])
      }
      if (u.pathname === '/api/tickets/KATA-02/attachments' && req.method === 'POST') {
        return send(201, { id: 'KATA-02', attachments: [
          { id: 'a1', filename: 'a.png', size: 3, url: 'https://s/a1' },
          { id: 'a2', filename: 'b.txt', size: 2, url: 'https://s/a2' },
        ] })
      }
      if (u.pathname === '/api/tickets/KATA-02' && req.method === 'PATCH') {
        return send(200, { id: 'TK-12', movedFrom: 'KATA-02', updated: ['projectId'] })
      }
      send(404, { error: 'not_found' })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => new Promise((r) => server.close(r)))

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tk-repo-'))
  writeFileSync(join(dir, '.horizontal'), '{"project":"kata"}\n')
  return dir
}

function tk(args, { cwd, env = {}, input } = {}) {
  const cfg = mkdtempSync(join(tmpdir(), 'tk-cfg-'))
  return new Promise((resolve) => {
    const child = execFile('node', [HZ, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: cfg, XDG_CONFIG_HOME: cfg, HORIZONTAL_API_URL: url, HORIZONTAL_API_KEY: KEY, ...env },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr, cfg }))
    if (input !== undefined) child.stdin.end(input)
  })
}

const last = () => seen[seen.length - 1]

describe('tk contra unui server fals', () => {
  it('create fără --wave ia valul activ și proiectul din .horizontal', async () => {
    const r = await tk(['create', 'Auth flow', '--deps', 'KATA-01', '--urgent', '--desc', 'd'], { cwd: repo() })
    expect(r.stdout.trim()).toBe('KATA-09')
    expect(last().headers['x-api-key']).toBe(KEY)
    expect(JSON.parse(last().raw.toString())).toEqual({
      projectId: 'kata', title: 'Auth flow', wave: 3, deps: ['KATA-01'], desc: 'd', notes: '', assigneeId: null, urgent: true,
    })
  })

  it('create pe titlu existent → duplicate:', async () => {
    const r = await tk(['--create', '--title', 'Dublura', '--wave', '1', '--project', 'kata'])
    expect(r.stdout.trim()).toBe('duplicate: KATA-02')
  })

  it('list scrie un rând pe tichet, cu numele valului', async () => {
    const r = await tk(['list', '--wave', '1'], { cwd: repo() })
    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual([
      'KATA-01  [wave 1 · I / MVP] ✓  Schema',
      'KATA-02  [wave 1 · I / MVP]  #auth  API  ← KATA-01  !',
    ])
    expect(seen.some((s) => s.url === '/api/tickets?project=kata&wave=1')).toBe(true)
  })

  it('list --json --done false dă doar deschisele, brut', async () => {
    const r = await tk(['list', '--json', '--done', 'false'], { cwd: repo() })
    expect(JSON.parse(r.stdout).map((t) => t.id)).toEqual(['KATA-02'])
  })

  it('attach trimite multipart cu fișierele, fără Content-Type JSON', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.png'), 'png')
    writeFileSync(join(dir, 'b.txt'), 'hi')
    const r = await tk(['attach', 'KATA-02', 'a.png', 'b.txt'], { cwd: dir })
    expect(r.stdout.trim().split('\n')).toEqual(['a1  a.png  3  https://s/a1', 'a2  b.txt  2  https://s/a2'])
    const req = last()
    expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const body = req.raw.toString()
    expect(body).toContain('filename="a.png"')
    expect(body).toContain('filename="b.txt"')
    expect(body.match(/name="file"/g)).toHaveLength(2)
  })

  it('update --project mută și spune noul ID', async () => {
    const r = await tk(['update', 'KATA-02', '--project', 'tk'], { cwd: repo() })
    expect(r.stdout.trim()).toBe('moved: KATA-02 -> TK-12')
    expect(JSON.parse(last().raw.toString())).toEqual({ projectId: 'tk' })
  })

  it('fără proiect: mesaj clar, exit 1, nicio cerere', async () => {
    const n = seen.length
    const r = await tk(['list'], { cwd: mkdtempSync(join(tmpdir(), 'tk-gol-')) })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('tk init')
    expect(seen.length).toBe(n)
  })

  it('init scrie .horizontal, TICKETING.md și adaugă @TICKETING.md o singură dată', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tk-init-'))
    writeFileSync(join(dir, 'CLAUDE.md'), '# Proiect\n')
    expect((await tk(['init', 'Katalist'], { cwd: dir })).code).toBe(0)
    expect((await tk(['init', 'kata'], { cwd: dir })).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, '.horizontal'), 'utf8'))).toEqual({ project: 'kata' })
    expect(readFileSync(join(dir, 'TICKETING.md'), 'utf8')).toContain('tk guide')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# Proiect\n\n@TICKETING.md\n')
    const bad = await tk(['init', 'nu-exista'], { cwd: mkdtempSync(join(tmpdir(), 'tk-init-')) })
    expect(bad.code).toBe(1)
    expect(bad.stdout.trim()).toBe('project_not_found')
  })

  it('login scrie config.json cu modul 600 și nu afișează cheia', async () => {
    const r = await tk(['login', '--url', url + '/', '--key', '-'], { input: 'cheie-din-stdin\n', env: { HORIZONTAL_API_URL: '', HORIZONTAL_API_KEY: '' } })
    const p = join(r.cfg, 'horizontal', 'config.json')
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ apiUrl: url, apiKey: 'cheie-din-stdin' })
    expect(statSync(p).mode & 0o777).toBe(0o600)
    expect(r.stdout + r.stderr).not.toContain('cheie-din-stdin')
    // Cheia din stdin nu e cea a serverului fals → verificarea o refuză, după salvare.
    expect(r.stderr).toContain('unauthorized')
  })

  it('guide tipărește ghidul de lângă tk.mjs', async () => {
    const r = await tk(['guide'], { cwd: repo() })
    expect(r.stdout).toContain('Direcția dependențelor')
    expect(r.stdout).toContain('proiectul curent: kata')
  })
})

describe('install.mjs', () => {
  it('pune symlinkul în HZ_BIN_DIR și îl scoate', async () => {
    const bin = join(mkdtempSync(join(tmpdir(), 'tk-bin-')), 'bin')
    const run = (args) => new Promise((resolve) => execFile('node', [join(HERE, 'install.mjs'), ...args], {
      env: { PATH: '/usr/bin', HZ_BIN_DIR: bin, HOME: '/nonexistent' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })))
    const a = await run([])
    expect(a.code).toBe(0)
    expect(a.stderr).toContain('nu e în PATH')
    expect(lstatSync(join(bin, 'tk')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(bin, 'tk'))).toBe(HZ)
    expect((await run([])).code).toBe(0) // reinstalarea înlocuiește legătura
    expect((await run(['--uninstall'])).code).toBe(0)
    expect(existsSync(join(bin, 'tk'))).toBe(false)
  })
})
