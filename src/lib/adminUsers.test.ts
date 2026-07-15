import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

import { listUsers, createUser } from './adminUsers'

beforeEach(() => invoke.mockReset())

describe('listUsers', () => {
  it('invokes admin-users with list_users and returns users', async () => {
    invoke.mockResolvedValue({ data: { users: [{ id: '1', email: 'a@b.c', access: [] }] }, error: null })
    const users = await listUsers()
    expect(invoke).toHaveBeenCalledWith('admin-users', { body: { action: 'list_users' } })
    expect(users).toEqual([{ id: '1', email: 'a@b.c', access: [] }])
  })
  it('throws on error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(listUsers()).rejects.toThrow('boom')
  })
})

describe('createUser', () => {
  it('sends create_user with email, password, access', async () => {
    invoke.mockResolvedValue({ data: { id: 'new' }, error: null })
    const id = await createUser('a@b.c', 'pw', [{ project_id: 'p', role: 'write' }])
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'create_user', payload: { email: 'a@b.c', password: 'pw', access: [{ project_id: 'p', role: 'write' }] } },
    })
    expect(id).toBe('new')
  })
})
