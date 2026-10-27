import { describe, it, expect } from 'vitest'
import { authorFilter, authorOf, eventsOut, parseCommentInput, pickAuthor, rpcFailure, type EventRow } from './_thread-lib'

const PEOPLE = [
  { id: 'a-ion', name: 'Ionut', user_id: 'u-ion' },
  { id: 'a-ana', name: 'Ana', user_id: null },
]

const ev = (over: Partial<EventRow>): EventRow => ({
  id: 'e1', kind: 'comment', author_id: 'u-ion', body: 'salut',
  handoff_from: null, handoff_to: null, created_at: '2026-10-27T10:00:00+00:00', edited_at: null, ...over,
})

describe('authorOf', () => {
  it('un cont → numele din assignees (după user_id)', () => {
    expect(authorOf(ev({}), PEOPLE)).toEqual({ author: 'Ionut', authorId: 'u-ion' })
  })
  it('fără autor → nota mutată din vechiul câmp notes', () => {
    expect(authorOf(ev({ author_id: null }), PEOPLE)).toEqual({ author: 'notă mutată', authorId: null })
  })
  it('un cont nelegat de assignees → necunoscut', () => {
    expect(authorOf(ev({ author_id: 'u-x' }), PEOPLE).author).toBe('necunoscut')
  })
})

describe('autorul din cerere', () => {
  it('un uuid caută și rândul, și contul; un nume, după nume', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(authorFilter(id)).toBe(`or=(id.eq.${id},user_id.eq.${id})`)
    expect(authorFilter('Ionut')).toBe('name=ilike.Ionut')
  })
  it('trebuie să fie un om CU cont: fără cont nu poate fi autor', () => {
    expect(pickAuthor([PEOPLE[0]])).toEqual({ userId: 'u-ion', assigneeId: 'a-ion', name: 'Ionut' })
    expect(pickAuthor([PEOPLE[1]])).toEqual({ error: 'author_not_linked' })
    expect(pickAuthor([])).toEqual({ error: 'author_not_found' })
  })
})

describe('eventsOut', () => {
  it('comentariul: autor, oră, editat, fișierele lui; fără cheia handoff', () => {
    const files = new Map([['e1', [{ id: 'f1', filename: 'a.png' }]]])
    const [c] = eventsOut([ev({ edited_at: '2026-10-27T11:00:00+00:00' })], PEOPLE, files)
    expect(c).toEqual({
      id: 'e1', kind: 'comment', author: 'Ionut', authorId: 'u-ion', body: 'salut',
      createdAt: '2026-10-27T10:00:00+00:00', editedAt: '2026-10-27T11:00:00+00:00',
      attachments: [{ id: 'f1', filename: 'a.png' }],
    })
  })
  it('pasa: de la cine la cine; către null = înapoi la creator', () => {
    const [h] = eventsOut([ev({ kind: 'handoff', body: '', handoff_from: 'a-ion', handoff_to: null })], PEOPLE)
    expect(h.handoff).toEqual({ from: { id: 'a-ion', name: 'Ionut' }, to: null })
    expect(h.attachments).toEqual([])
  })
})

describe('parseCommentInput', () => {
  it('autor + text', () => {
    expect(parseCommentInput({ author: ' Ionut ', body: 'gata' }))
      .toEqual({ author: 'Ionut', body: 'gata', handoff: false, to: null, attachmentIds: [] })
  })
  it('cheia to = pasează; null sau gol = înapoi la creator', () => {
    expect(parseCommentInput({ author: 'I', body: 'ia-l', to: ' Ana ' })).toMatchObject({ handoff: true, to: 'Ana' })
    expect(parseCommentInput({ author: 'I', to: null })).toMatchObject({ handoff: true, to: null })
    expect(parseCommentInput({ author: 'I', to: '' })).toMatchObject({ handoff: true, to: null })
  })
  it('numai fișiere e un comentariu valid; id-urile se dedublează', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(parseCommentInput({ author: 'I', attachmentIds: [id, id] })).toMatchObject({ body: '', attachmentIds: [id] })
  })
  it('refuzuri', () => {
    expect(parseCommentInput({ body: 'x' })).toEqual({ error: 'author_required' })
    expect(parseCommentInput({ author: '  ', body: 'x' })).toEqual({ error: 'author_required' })
    expect(parseCommentInput({ author: 'I' })).toEqual({ error: 'empty_comment' })
    expect(parseCommentInput({ author: 'I', body: '   ' })).toEqual({ error: 'empty_comment' })
    expect(parseCommentInput({ author: 'I', body: 3 })).toEqual({ error: 'invalid_body' })
    expect(parseCommentInput({ author: 'I', body: 'x', to: 5 })).toEqual({ error: 'invalid_to' })
    expect(parseCommentInput({ author: 'I', body: 'x', attachmentIds: ['nu-e-uuid'] })).toEqual({ error: 'invalid_attachment_ids' })
    expect(parseCommentInput([])).toEqual({ error: 'invalid_json' })
  })
})

describe('rpcFailure', () => {
  it('funcția lipsă (PGRST202) = migrarea nerulată, nu „not found”', () => {
    expect(rpcFailure(404, { code: 'PGRST202' })).toMatchObject({ status: 501, body: { error: 'migration_missing' } })
  })
  it('codurile funcției', () => {
    expect(rpcFailure(400, { code: 'HZC01' })).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(rpcFailure(400, { code: 'HZC02' })).toEqual({ status: 400, body: { error: 'empty_comment' } })
    expect(rpcFailure(400, { code: 'HZC03' })).toEqual({ status: 422, body: { error: 'author_not_found' } })
    expect(rpcFailure(500, { code: 'XX000' }).status).toBe(502)
  })
})
