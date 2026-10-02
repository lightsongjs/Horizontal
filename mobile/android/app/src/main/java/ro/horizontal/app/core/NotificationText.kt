package ro.horizontal.app.core

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

data class NotificationText(val title: String, val body: String, val tag: String)

/**
 * Port al lui `planNotification` din `src/lib/pushPayload.ts` — aceleași
 * `pushPayload.fixtures.json`. Ora în fusul DISPOZITIVULUI (`zone` =
 * `ZoneId.systemDefault()` în producție): mementoul e citit de un om care se
 * uită la ceasul lui.
 */
fun planNotification(id: String, title: String?, dueAt: String?, allDay: Boolean, projectName: String?, zone: ZoneId): NotificationText {
    val t = title?.trim().orEmpty().ifEmpty { "Sarcină fără titlu" }
    val parts = ArrayList<String>()
    if (dueAt != null && !allDay) parseIso(dueAt)?.let {
        val z = Instant.ofEpochMilli(it).atZone(zone)
        parts += String.format(Locale.ROOT, "%02d:%02d", z.hour, z.minute)
    }
    if (!projectName.isNullOrEmpty()) parts += projectName
    return NotificationText(t, if (parts.isEmpty()) id else parts.joinToString(" · "), id)
}
