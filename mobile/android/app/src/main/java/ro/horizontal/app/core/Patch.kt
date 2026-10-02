package ro.horizontal.app.core

import java.net.URLEncoder

data class PatchRequest(val query: String, val body: Map<String, Any?>)

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

/**
 * Cererea PostgREST pentru o acțiune. Scrieri ABSOLUTE (regula din
 * `reminderMutation`): `done: true`, `remind_at` = o oră.
 *
 * „Gata" poartă garda `due_at`, DOAR pe recurente: acolo trigger-ul
 * `issues_zz_advance_recurrence` sare la fiecare tranziție false→true și lasă
 * `done = false`, deci o retrimitere (răspunsul pierdut, cererea refăcută) ar
 * sări încă o dată. Cu garda, a doua cerere găsește altă scadență și nu
 * atinge nimic — 0 rânduri = deja făcut. Pe o sarcină NErecurentă `done: true`
 * e idempotent, iar garda ar fi blocat în tăcere un „Gata" pe o sarcină a cărei
 * scadență s-a mutat pe alt dispozitiv — de-aia `rrule.is.null` o lasă să treacă.
 * Valoarea e între ghilimele: în `or=(…)` punctul, virgula și parantezele sunt
 * rezervate, iar o oră ISO are puncte.
 */
fun buildPatch(a: NativeAction): PatchRequest = when (a.kind) {
    NativeAction.Kind.DONE -> PatchRequest(
        "id=eq.${enc(a.id)}&or=" + enc("(" + (a.prevDueAt?.let { "due_at.eq.\"$it\"" } ?: "due_at.is.null") + ",rrule.is.null)"),
        mapOf("done" to true),
    )
    NativeAction.Kind.UNTIL -> PatchRequest(
        "id=eq.${enc(a.id)}",
        buildMap { put("remind_at", isoJs(a.remindAt ?: 0)); a.dueAt?.let { put("due_at", it) } },
    )
}
