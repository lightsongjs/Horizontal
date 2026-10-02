import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { withoutReadRetries } from './supabase'

describe('withoutReadRetries', () => {
  it('o citire fără rețea cade din prima, fără cele trei reîncercări ale postgrest-js', async () => {
    let calls = 0
    const failing = async () => { calls++; throw new TypeError('Failed to fetch') }
    const client = withoutReadRetries(
      createClient('http://localhost:54321', 'anon', { global: { fetch: failing }, auth: { persistSession: false } }),
    )
    const { error } = await client.from('issues').select('id')
    expect(error).not.toBeNull()
    expect(calls).toBe(1)
  })
})
