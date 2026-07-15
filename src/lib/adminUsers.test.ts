import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

import { listUsers, createUser, setAccess, resetPassword, deleteUser } from './adminUsers'

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

describe('mutations send correct action + payload', () => {
  beforeEach(() => invoke.mockResolvedValue({ data: { ok: true }, error: null }))

  it('setAccess sends set_access with user_id + access', async () => {
    await setAccess('u1', [{ project_id: 'p', role: 'read' }])
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_access', payload: { user_id: 'u1', access: [{ project_id: 'p', role: 'read' }] } },
    })
  })

  it('resetPassword sends reset_password with user_id + password', async () => {
    await resetPassword('u1', 'newpw')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'reset_password', payload: { user_id: 'u1', password: 'newpw' } },
    })
  })

  it('deleteUser sends delete_user with user_id', async () => {
    await deleteUser('u1')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'delete_user', payload: { user_id: 'u1' } },
    })
  })

  it('surfaces app-level {error} body as a throw', async () => {
    invoke.mockResolvedValue({ data: { error: 'forbidden' }, error: null })
    await expect(deleteUser('u1')).rejects.toThrow('forbidden')
  })
})
