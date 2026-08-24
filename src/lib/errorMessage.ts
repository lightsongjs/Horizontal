// Un mesaj citibil din orice a fost aruncat.
//
// De ce există: `e instanceof Error ? e.message : String(e)` — tiparul folosit
// în toată aplicația — dă `[object Object]` pentru erorile supabase-js.
// PostgREST întoarce un OBIECT SIMPLU (`{ message, details, hint, code }`), nu o
// instanță de `Error`, deci ramura de `String(e)` produce exact bannerul
// „⚠ [object Object]": o eroare care se vede, dar nu spune nimic.
//
// Măsurat pe o migrare nerulată: serverul spunea
// `column issues.due_at does not exist`, iar utilizatorul vedea `[object Object]`.

/** Câmpurile pe care le poartă o eroare PostgREST / Storage din supabase-js. */
interface ErrorLike {
  message?: unknown
  details?: unknown
  hint?: unknown
  code?: unknown
  error_description?: unknown
  error?: unknown
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  const direct = str(e)
  if (direct) return direct

  if (typeof e === 'object' && e !== null) {
    const o = e as ErrorLike
    const main = str(o.message) ?? str(o.error_description) ?? str(o.error) ?? str(o.details)
    // `hint` e adesea partea acționabilă („Perhaps you meant…"), deci se
    // păstrează — dar numai lângă un mesaj, nu în locul lui.
    const hint = str(o.hint)
    if (main) return hint ? `${main} (${hint})` : main
    // Fără text, codul e tot ce avem, și e mai mult decât nimic: se poate căuta.
    const code = str(o.code)
    if (code) return `Eroare ${code}`
  }
  return 'Eroare necunoscută'
}
