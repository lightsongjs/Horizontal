package ro.horizontal.app.core

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

// `Instant.toString()` omite milisecundele când sunt zero; `toISOString()` din
// JS nu. Cheia unui memento (`id@ISO`) e comparată între pagină și cutie.
private val JS_ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

fun isoJs(ms: Long): String = JS_ISO.format(Instant.ofEpochMilli(ms))

/** ISO cu decalaj (`Z`, `+00:00`, fracțiuni până la nanosecunde, ca din Postgres). Null dacă nu se citește. */
fun parseIso(s: String?): Long? = try {
    if (s == null) null else OffsetDateTime.parse(s).toInstant().toEpochMilli()
} catch (e: DateTimeParseException) { null }

fun reminderKey(id: String, at: Long): String = "$id@${isoJs(at)}"
