package ro.horizontal.app.core

/**
 * „Distribuie → Horizontal" (YouTube, Chrome…): ce intră în titlul ferestrei de
 * quick add. Linkul stă în TITLU, nu în descriere — acolo se deschide cu o
 * atingere. YouTube trimite doar URL-ul în `EXTRA_TEXT`; alte aplicații pun
 * titlul paginii în `EXTRA_SUBJECT` și-l pun înaintea linkului, dacă textul nu-l
 * conține deja. O ciornă existentă nu se aruncă: textul nou vine după ea.
 */
fun sharedTitle(draft: String, text: String?, subject: String?): String? {
    val t = text?.trim().orEmpty()
    val s = subject?.trim().orEmpty()
    val shared = when {
        t.isEmpty() -> s
        s.isEmpty() || t.contains(s) -> t
        else -> "$s $t"
    }.replace(Regex("\\s+"), " ")
    if (shared.isEmpty()) return null
    val d = draft.trim()
    return if (d.isEmpty()) shared else "$d $shared"
}
