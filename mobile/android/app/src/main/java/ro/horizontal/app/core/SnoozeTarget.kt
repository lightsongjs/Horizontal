package ro.horizontal.app.core

import java.time.Instant
import java.time.ZoneId

sealed class SnoozeOption {
    data class Minutes(val minutes: Int) : SnoozeOption()
    object Tomorrow9 : SnoozeOption()
    data class At(val at: Long) : SnoozeOption()
}

/** `snoozedFrom` = baza amânării (`snoozeBase`); `null` = n-avea memento, nimic de ținut minte. */
data class SnoozePatch(val remindAt: Long, val dueAt: Long?, val snoozedFrom: Long? = null)

/**
 * Port al lui `snoozeTarget` din `src/lib/reminderAction.ts` — aceleași
 * `reminderAction.fixtures.json`. Minutele mută doar mementoul; ce trece în
 * altă zi mută și scadența pe ziua mementoului, cu ora ei păstrată.
 *
 * `remindAt`/`snoozedFrom` = ce știe planul despre tichet (`Reminder.at`,
 * `Reminder.snoozedFrom`): din ele iese baza amânării, scrisă în `snoozed_from`.
 */
fun snoozeTarget(option: SnoozeOption, now: Long, dueAt: String?, zone: ZoneId, remindAt: Long? = null, snoozedFrom: Long? = null): SnoozePatch {
    val t = snoozeTime(option, now, dueAt, zone)
    return t.copy(snoozedFrom = snoozeBase(remindAt, snoozedFrom, parseIso(dueAt), t.dueAt))
}

private fun snoozeTime(option: SnoozeOption, now: Long, dueAt: String?, zone: ZoneId): SnoozePatch {
    val remind = when (option) {
        is SnoozeOption.Minutes -> return SnoozePatch(now + option.minutes * 60_000L, null)
        SnoozeOption.Tomorrow9 -> Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(1).atTime(9, 0).atZone(zone).toInstant().toEpochMilli()
        is SnoozeOption.At -> option.at
    }
    val due = parseIso(dueAt) ?: return SnoozePatch(remind, null)
    val dueZ = Instant.ofEpochMilli(due).atZone(zone)
    val remDay = Instant.ofEpochMilli(remind).atZone(zone).toLocalDate()
    if (!remDay.isAfter(dueZ.toLocalDate())) return SnoozePatch(remind, null)
    return SnoozePatch(remind, remDay.atTime(dueZ.toLocalTime()).atZone(zone).toInstant().toEpochMilli())
}

/**
 * Port al lui `snoozeBase`: mementoul PLANIFICAT al apariției curente
 * (`snoozedFrom ?: remindAt` — a doua amânare păstrează baza primei), mutat cu
 * scadența dacă amânarea o mută. Saltul recurenței pleacă de la el; fără el o
 * sarcină zilnică de la 08:00, amânată până la 12:00:39 și bifată, suna apoi în
 * fiecare zi la 12:00:39 (ROUTIN-12, 2026-11-06).
 */
fun snoozeBase(remindAt: Long?, snoozedFrom: Long?, dueAt: Long?, newDueAt: Long?): Long? {
    val base = snoozedFrom ?: remindAt ?: return null
    return base + if (dueAt != null && newDueAt != null) newDueAt - dueAt else 0L
}
