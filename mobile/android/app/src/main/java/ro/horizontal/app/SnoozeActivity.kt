package ro.horizontal.app

import android.app.Activity
import android.app.DatePickerDialog
import android.app.PendingIntent
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import ro.horizontal.app.core.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Foaia „Amână…". Deschisă DIRECT din butonul notificării
 * (`PendingIntent.getActivity`): din Android 12, o activitate pornită dintr-un
 * receiver după atingerea unui buton e blocată („trampoline"). Nu e WebView —
 * pornește instant și nu încarcă aplicația. Pe ecranul blocat Android cere
 * deblocarea întâi; „Gata" și „15 min" merg și fără.
 */
class SnoozeActivity : Activity() {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val hm = DateTimeFormatter.ofPattern("HH:mm")

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_snooze)
        val id = intent.getStringExtra("id") ?: return finish()
        val dueAt = intent.getStringExtra("dueAt")
        findViewById<TextView>(R.id.title).text = intent.getStringExtra("title")
        // targetSdk 36 = edge-to-edge impus: fără inset, ultimul rând ar sta sub bara de navigare.
        val sheet = findViewById<View>(R.id.sheet)
        val padBottom = sheet.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(sheet) { v, ins ->
            v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, padBottom + ins.getInsets(WindowInsetsCompat.Type.systemBars()).bottom); ins
        }
        val now = System.currentTimeMillis()
        // Ora afișată e calculată la deschidere; cea aplicată, la atingere — foaia poate sta deschisă minute.
        fun bind(rowId: Int, timeId: Int, opt: SnoozeOption, label: (Long) -> String) {
            findViewById<TextView>(timeId).text = label(snoozeTarget(opt, now, dueAt, zone).remindAt)
            findViewById<View>(rowId).setOnClickListener { apply(id, dueAt, snoozeTarget(opt, System.currentTimeMillis(), dueAt, zone)) }
        }
        val at = { ms: Long -> Instant.ofEpochMilli(ms).atZone(zone).format(hm) }
        bind(R.id.opt5, R.id.opt5Time, SnoozeOption.Minutes(5), at)
        bind(R.id.opt30, R.id.opt30Time, SnoozeOption.Minutes(30), at)
        bind(R.id.opt60, R.id.opt60Time, SnoozeOption.Minutes(60), at)
        bind(R.id.opt180, R.id.opt180Time, SnoozeOption.Minutes(180), at)
        bind(R.id.optTomorrow, R.id.optTomorrowTime, SnoozeOption.Tomorrow9) { "mâine ${at(it)}" }
        findViewById<View>(R.id.optCustom).setOnClickListener { pickCustom(id, dueAt) }
        findViewById<View>(R.id.scrim).setOnClickListener { finish() }
    }

    /**
     * `singleInstance`: cu foaia deschisă pentru A, „Amână…" pe B nu creează o foaie
     * nouă, ci livrează intentul aici. Fără asta foaia ar fi rămas legată de A
     * (`intent` vechi, ascultătorii puși în `onCreate`) și ar fi amânat A.
     */
    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        setIntent(i)
        recreate()
    }

    private fun pickCustom(id: String, dueAt: String?) {
        val today = LocalDate.now(zone)
        DatePickerDialog(this, { _, y, m, d ->
            TimePickerDialog(this, { _, h, min ->
                val ms = LocalDate.of(y, m + 1, d).atTime(h, min).atZone(zone).toInstant().toEpochMilli()
                // O oră deja trecută ar suna imediat: nu e o amânare.
                if (ms <= System.currentTimeMillis()) { Toast.makeText(this, "Ora a trecut deja", Toast.LENGTH_SHORT).show(); return@TimePickerDialog }
                apply(id, dueAt, snoozeTarget(SnoozeOption.At(ms), System.currentTimeMillis(), dueAt, zone))
            }, 9, 0, true).show()
        }, today.year, today.monthValue - 1, today.dayOfMonth).apply {
            // Zilele trecute nici nu se pot alege; ora de azi deja trecută o prinde verificarea de mai sus.
            datePicker.minDate = today.atStartOfDay(zone).toInstant().toEpochMilli()
        }.show()
    }

    private fun apply(id: String, prevDue: String?, t: SnoozePatch) {
        Actions.dispatch(this, NativeAction(UUID.randomUUID().toString(), NativeAction.Kind.UNTIL, id,
            remindAt = t.remindAt, dueAt = t.dueAt?.let(::isoJs), prevDueAt = prevDue,
            title = intent.getStringExtra("title") ?: "", body = intent.getStringExtra("body") ?: "",
            allDay = intent.getBooleanExtra("allDay", false), createdAt = System.currentTimeMillis()))
        finish()
    }

    companion object {
        fun pendingIntent(ctx: Context, r: Reminder): PendingIntent = PendingIntent.getActivity(ctx, "${r.id}|more".hashCode(),
            Intent(ctx, SnoozeActivity::class.java).putExtra("id", r.id).putExtra("title", r.title).putExtra("body", r.body)
                .putExtra("dueAt", r.dueAt).putExtra("allDay", r.allDay).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
