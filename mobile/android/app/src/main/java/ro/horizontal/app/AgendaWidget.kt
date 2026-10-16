package ro.horizontal.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Build
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import ro.horizontal.app.core.*
import java.time.ZoneId

/**
 * Agenda: restanțe + 7 zile, în „Senin" (`design/android-widget/index.html`).
 * Desenul e o funcție de `PlanStore` — nicio stare proprie. Două forme, alese de
 * launcher după mărime (API 31, fără rundă prin aplicație): 4×4 și compactul 4×2.
 */
class AgendaWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { Widgets.refresh(ctx) }

    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            ACTION_REFRESH -> { SyncWorker.now(ctx); Widgets.refresh(ctx) }
            ACTION_MIDNIGHT -> Widgets.refresh(ctx)
            else -> super.onReceive(ctx, intent)
        }
    }

    companion object {
        const val ACTION_REFRESH = "ro.horizontal.app.WIDGET_REFRESH"
        const val ACTION_MIDNIGHT = "ro.horizontal.app.WIDGET_MIDNIGHT"

        /**
         * Compactul în colecție are un plafon: fiecare formă își poartă propria listă
         * de rânduri prin binder (limita de ~1 MB a tranzacției), iar 4×2 arată oricum
         * câteva rânduri. 4×4 le ține pe toate (`AGENDA_LIMIT`).
         */
        private const val COMPACT_LIMIT = 60

        /** Pragul dintre forme: sub ~240dp înălțime nu încap antetul cu dată și rândurile pe două linii. */
        private val COMPACT_SIZE = SizeF(180f, 110f)
        private val FULL_SIZE = SizeF(180f, 240f)

        /** Agenda văzută de widget — și de notificarea din bară (`Shade`), ca numărul să fie același. */
        fun stateOf(s: PlanStore.State, now: Long, zone: ZoneId): AgendaState =
            agendaState(s.agendaPage, s.agendaNative, s.queue, now, zone, s.agendaHeld,
                createsAsAgenda(s.creates, maxOf(s.agendaPage?.readAt ?: 0, s.agendaNative?.readAt ?: 0)), s.edits)

        fun render(ctx: Context, s: PlanStore.State, now: Long = System.currentTimeMillis()): RemoteViews {
            val zone = ZoneId.systemDefault()
            val state = stateOf(s, now, zone)
            val full = build(ctx, state, now, zone, compact = false)
            if (Build.VERSION.SDK_INT < 31) return full
            return RemoteViews(mapOf(COMPACT_SIZE to build(ctx, state, now, zone, compact = true), FULL_SIZE to full))
        }

        private fun build(ctx: Context, state: AgendaState, now: Long, zone: ZoneId, compact: Boolean): RemoteViews {
            val v = RemoteViews(ctx.packageName, if (compact) R.layout.widget_agenda_compact else R.layout.widget_agenda)
            v.setOnClickPendingIntent(R.id.w_brand, Widgets.openApp(ctx))
            v.setOnClickPendingIntent(R.id.w_add, Widgets.quick(ctx))
            if (!compact) {
                v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 1,
                    Intent(ctx, AgendaWidget::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE))
                v.setTextViewText(R.id.w_sub, todayLine(now, zone))
            }

            val sections = (state as? AgendaState.Ready)?.sections.orEmpty()
            v.setTextViewText(R.id.w_count, todayCount(sections).takeIf { it > 0 }?.toString() ?: "")

            // Stările goale: fără date încă (instalare proaspătă) ≠ nimic de făcut.
            val empty: Pair<String, String>? = when {
                state is AgendaState.NoData -> "Încă nu știu sarcinile tale" to "Deschide aplicația o dată, ca să apară aici."
                sections.isEmpty() -> "Nimic pe azi" to "Nici în următoarele 7 zile."
                else -> null
            }
            val listVis = if (empty == null) View.VISIBLE else View.GONE
            v.setViewVisibility(R.id.w_list, listVis)
            v.setViewVisibility(R.id.w_fade, listVis)
            v.setViewVisibility(R.id.w_empty, if (empty == null) View.GONE else View.VISIBLE)
            v.setTextViewText(R.id.w_empty_title, empty?.first ?: "")
            v.setTextViewText(R.id.w_empty_sub, empty?.second ?: "")
            if (!compact) {
                val noData = state is AgendaState.NoData
                v.setViewVisibility(R.id.w_empty_icon, if (noData) View.GONE else View.VISIBLE)
                v.setViewVisibility(R.id.w_empty_btn, if (noData) View.VISIBLE else View.GONE)
                v.setOnClickPendingIntent(R.id.w_empty_btn, Widgets.openApp(ctx))
            }
            if (empty != null || Build.VERSION.SDK_INT < 31) return v

            v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 2,
                Intent(ctx, WidgetTapActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            // Trei tipuri de element: cap de grup, rând, „Nimic pe azi".
            val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(3)
            val c = Colors(ctx)
            var n = 0
            val limit = if (compact) COMPACT_LIMIT else Int.MAX_VALUE
            if (freeToday(sections)) {
                items.addItem(FREE_ID, RemoteViews(ctx.packageName, if (compact) R.layout.widget_agenda_free_compact else R.layout.widget_agenda_free))
                n++
            }
            sections.forEachIndexed { i, sec ->
                if (n >= limit) return@forEachIndexed
                val headShown = showsHead(i, sec)
                if (headShown) { items.addItem(-(i + 1).toLong(), head(ctx, sec, compact, c)); n++ }
                sec.items.forEachIndexed { j, it ->
                    if (n >= limit) return@forEachIndexed
                    // Linia de păr doar ÎNTRE rânduri: primul dintr-un grup (sau primul din listă) n-o are.
                    items.addItem(it.id.hashCode().toLong() shl 8, row(ctx, it, sec.overdue, j > 0, now, zone, compact, c)); n++
                }
            }
            v.setRemoteAdapter(R.id.w_list, items.build())
            return v
        }

        private const val FREE_ID = -1000L

        private class Colors(ctx: Context) {
            val danger = ContextCompat.getColor(ctx, R.color.w_danger)
            val ink = ContextCompat.getColor(ctx, R.color.w_ink)
            val ink2 = ContextCompat.getColor(ctx, R.color.w_ink2)
            val ink3 = ContextCompat.getColor(ctx, R.color.w_ink3)
            val ring = ContextCompat.getColor(ctx, R.color.w_ring_default)
        }

        /** Culoarea cu alfa înmulțit — inelul e puțin mai stins decât discul „gata" (78% în machetă). */
        private fun fade(color: Int, alpha: Float) = (((color ushr 24) * alpha).toInt() shl 24) or (color and 0x00FFFFFF)

        @RequiresApi(31)
        private fun head(ctx: Context, sec: AgendaSection, compact: Boolean, c: Colors): RemoteViews {
            val h = RemoteViews(ctx.packageName, if (compact) R.layout.widget_agenda_section_compact else R.layout.widget_agenda_section)
            val sh = sectionHead(sec)
            h.setTextViewText(R.id.s_label, sh.label)
            // Explicit la fiecare legare: capetele se refolosesc și ele.
            h.setTextColor(R.id.s_label, if (sec.overdue) c.danger else c.ink)
            h.setViewVisibility(R.id.s_icon, if (sec.overdue) View.VISIBLE else View.GONE)
            h.setTextViewText(R.id.s_count, if (sh.date == null) sec.items.size.toString() else "")
            h.setTextColor(R.id.s_count, if (sec.overdue) fade(c.danger, 0.7f) else c.ink3)
            h.setViewVisibility(R.id.s_count, if (sh.date == null) View.VISIBLE else View.GONE)
            h.setTextViewText(R.id.s_date, sh.date ?: "")
            h.setViewVisibility(R.id.s_date, if (sh.date != null) View.VISIBLE else View.GONE)
            return h
        }

        @RequiresApi(31)
        private fun row(ctx: Context, it: AgendaItem, overdue: Boolean, separated: Boolean, now: Long, zone: ZoneId,
                        compact: Boolean, c: Colors): RemoteViews {
            val r = RemoteViews(ctx.packageName, if (compact) R.layout.widget_agenda_row_compact else R.layout.widget_agenda_row)
            r.setTextViewText(R.id.r_title, it.title)
            val meta = rowMeta(it, overdue, now, zone)
            r.setTextViewText(R.id.r_meta, meta)
            r.setViewVisibility(R.id.r_meta, if (meta.isEmpty()) View.GONE else View.VISIBLE)
            // Tot ce urmează e explicit pe FIECARE rând: lista refolosește rândurile la derulare, iar o
            // culoare / un inel urgent / o linie puse o dată rămâneau pe rândul refolosit.
            r.setTextColor(R.id.r_meta, if (overdue) c.danger else c.ink2)
            r.setInt(R.id.r_root, "setBackgroundResource",
                if (!separated) 0 else if (compact) R.drawable.w_row_sep_compact else R.drawable.w_row_sep)
            val project = accentArgb(it.projectAccent) ?: c.ring
            r.setViewVisibility(R.id.r_check, if (it.urgent) View.GONE else View.VISIBLE)
            r.setViewVisibility(R.id.r_check_urg, if (it.urgent) View.VISIBLE else View.GONE)
            val checked = intArrayOf(android.R.attr.state_checked)
            r.setColorStateList(R.id.r_check, "setButtonTintList",
                ColorStateList(arrayOf(checked, intArrayOf()), intArrayOf(project, fade(project, 0.78f))))
            r.setColorStateList(R.id.r_check_urg, "setButtonTintList", ColorStateList.valueOf(c.danger))
            r.setCompoundButtonChecked(R.id.r_check, false)
            r.setCompoundButtonChecked(R.id.r_check_urg, false)
            r.setInt(R.id.r_dot, "setColorFilter", project)
            r.setViewVisibility(R.id.r_dot, if (it.project != null) View.VISIBLE else View.GONE)
            if (!compact) {
                r.setViewVisibility(R.id.r_proj, if (it.project != null || it.recurring || it.hasReminder) View.VISIBLE else View.GONE)
                r.setTextViewText(R.id.r_project, it.project ?: "")
                r.setViewVisibility(R.id.r_project, if (it.project != null) View.VISIBLE else View.GONE)
                r.setViewVisibility(R.id.r_repeat, if (it.recurring) View.VISIBLE else View.GONE)
                r.setViewVisibility(R.id.r_bell, if (it.hasReminder) View.VISIBLE else View.GONE)
            }
            // Tot ce desenează foaia tichetului în primul cadru, fără să aștepte rețeaua.
            val base = Intent().putExtra(WidgetTapActivity.EXTRA_ID, it.id).putExtra(TicketActivity.EXTRA_TITLE, it.title)
                .putExtra(TicketActivity.EXTRA_DUE, it.dueAt).putExtra(TicketActivity.EXTRA_ALL_DAY, it.allDay)
                .putExtra(TicketActivity.EXTRA_PROJECT, it.project).putExtra(TicketActivity.EXTRA_REMINDER, it.hasReminder)
                .putExtra(TicketActivity.EXTRA_RECURRING, it.recurring)
            r.setOnClickFillInIntent(R.id.r_body, Intent(base).putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_OPEN))
            val done = RemoteViews.RemoteResponse.fromFillInIntent(Intent(base)
                .putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_DONE)
                .putExtra(WidgetTapActivity.EXTRA_DUE, it.dueAt).putExtra(WidgetTapActivity.EXTRA_TITLE, it.title)
                .putExtra(WidgetTapActivity.EXTRA_ALL_DAY, it.allDay))
            r.setOnCheckedChangeResponse(R.id.r_check, done)
            r.setOnCheckedChangeResponse(R.id.r_check_urg, done)
            return r
        }

        fun ids(ctx: Context): IntArray = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, AgendaWidget::class.java))
    }
}
