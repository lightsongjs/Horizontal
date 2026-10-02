package ro.horizontal.app.core

import java.time.Instant
import java.time.ZoneId

sealed class SnoozeOption {
    data class Minutes(val minutes: Int) : SnoozeOption()
    object Tomorrow9 : SnoozeOption()
    data class At(val at: Long) : SnoozeOption()
}

data class SnoozePatch(val remindAt: Long, val dueAt: Long?)

/**
 * Port al lui `snoozeTarget` din `src/lib/reminderAction.ts` — aceleași
 * `reminderAction.fixtures.json`. Minutele mută doar mementoul; ce trece în
 * altă zi mută și scadența pe ziua mementoului, cu ora ei păstrată.
 */
fun snoozeTarget(option: SnoozeOption, now: Long, dueAt: String?, zone: ZoneId): SnoozePatch {
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
