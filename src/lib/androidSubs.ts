import { supabase } from './supabase'
import { isAndroidChromeSub } from './androidCard'

/**
 * Id-urile abonamentelor web push ale lui Chrome de pe telefon, ale omului
 * logat (RLS `push_own` vede doar rândurile proprii). Cardul din „Azi" le
 * șterge, ecranul de verificare le numără — aceeași interogare, ca cele două
 * să nu spună lucruri diferite despre același telefon.
 *
 * Fără Supabase (modul local) nu există abonamente: `[]`, nu eroare.
 */
export async function readAndroidChromeSubIds(): Promise<string[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('push_subscriptions').select('id, ua')
  if (error) throw error
  return (data ?? []).filter((r) => isAndroidChromeSub(r.ua as string | null)).map((r) => String(r.id))
}

export async function deleteAndroidChromeSubs(ids: string[]): Promise<void> {
  if (!supabase || ids.length === 0) return
  const { error } = await supabase.from('push_subscriptions').delete().in('id', ids)
  if (error) throw error
}
