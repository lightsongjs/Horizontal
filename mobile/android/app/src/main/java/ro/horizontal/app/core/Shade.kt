package ro.horizontal.app.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Notificarea fixă din bara de notificări (D-185, „ca TickTick"): numărul de
 * azi și prima sarcină, plus „+". Aceeași agendă ca widget-ul (`agendaState`):
 * numărul e `todayCount` (restanțele și azi, doar ale mele, rutinele ascunse
 * până sună — fixarea nu-l schimbă), iar prima sarcină e prima fixată dintre
 * cele de azi și restante, cu „Fixată" în fața zilei, altfel prima de azi
 * (restanțele întâi). O fixată de mâine nu ține ziua ocupată.
 */
data class ShadeText(val count: Int, val title: String, val sub: String)

private val LUNI_APP = listOf("ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec")

/**
 * `dueChipDay` din `src/lib/schedule.ts`: „Azi", „Mâine", „Ieri", altfel „20 oct"
 * (anul doar când nu e cel curent). Fixtures comune: `src/lib/dueChipDay.fixtures.json`.
 */
fun dueChipDay(dueAt: Long, now: Long, zone: ZoneId): String {
    val d = Instant.ofEpochMilli(dueAt).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return when (ChronoUnit.DAYS.between(today, d)) {
        0L -> "Azi"
        1L -> "Mâine"
        -1L -> "Ieri"
        else -> dayMonth(d) + if (d.year == today.year) "" else " ${d.year}"
    }
}

private fun dayMonth(d: LocalDate) = "${d.dayOfMonth} ${LUNI_APP[d.monthValue - 1]}"

/**
 * `null` = nu se arată nimic: fără nicio listă (instalare proaspătă, după
 * deconectare) notificarea n-ar avea ce spune, iar „+" ar scrie fără cont.
 */
fun shadeText(state: AgendaState, now: Long, zone: ZoneId): ShadeText? {
    val sections = (state as? AgendaState.Ready)?.sections ?: return null
    val today = todayItems(sections, now, zone)
    val count = today.size
    // Ca rândul „Nimic pe azi" din widget (`freeToday`): ziua e liberă, dar urmează ceva —
    // cel mai apropiat, nu o fixată de peste trei zile.
    if (count == 0) {
        val next = daySections(sections.flatMap { it.items }, now, zone).firstOrNull()?.items?.firstOrNull()
            ?: return ShadeText(0, "Nimic pe azi", "Nici în următoarele 7 zile.")
        return ShadeText(0, "Nimic pe azi", "Urmează: ${next.title} · ${dueDayTime(next, now, zone)}")
    }
    val pinned = today.filter(::isPinned).minWithOrNull(pinnedOrder)
    val first = pinned ?: today.first()
    val parts = listOf(if (pinned != null) "Fixată" else "", dueDayTime(first, now, zone), if (count > 1) "încă ${count - 1}" else "")
    return ShadeText(count, first.title, parts.filter { it.isNotEmpty() }.joinToString(" · "))
}
