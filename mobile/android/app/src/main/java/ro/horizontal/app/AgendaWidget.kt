package ro.horizontal.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import ro.horizontal.app.core.*
import java.time.ZoneId

/** Agenda: restanțe + 7 zile. Desenul e o funcție de `PlanStore` — nicio stare proprie. */
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

        fun render(ctx: Context, s: PlanStore.State, now: Long = System.currentTimeMillis()): RemoteViews {
            val zone = ZoneId.systemDefault()
            val v = RemoteViews(ctx.packageName, R.layout.widget_agenda)
            v.setOnClickPendingIntent(R.id.w_brand, Widgets.openApp(ctx))
            v.setOnClickPendingIntent(R.id.w_add, Widgets.quick(ctx))
            v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 1,
                Intent(ctx, AgendaWidget::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE))

            val state = agendaState(s.agendaPage, s.agendaNative, s.queue, now, zone, s.agendaHeld,
                createsAsAgenda(s.creates, maxOf(s.agendaPage?.readAt ?: 0, s.agendaNative?.readAt ?: 0)))
            val empty = when {
                state is AgendaState.NoData -> "Deschide aplicația o dată, ca să apară sarcinile."
                state is AgendaState.Ready && state.count == 0 -> "Nimic restant, nimic azi."
                else -> null
            }
            v.setViewVisibility(R.id.w_list, if (empty == null) View.VISIBLE else View.GONE)
            v.setViewVisibility(R.id.w_empty, if (empty == null) View.GONE else View.VISIBLE)
            v.setTextViewText(R.id.w_empty, empty ?: "")
            v.setTextViewText(R.id.w_count, (state as? AgendaState.Ready)?.count?.takeIf { it > 0 }?.let { "· $it" } ?: "")
            if (state !is AgendaState.Ready || Build.VERSION.SDK_INT < 31) return v

            v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 2,
                Intent(ctx, WidgetTapActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
            val red = ContextCompat.getColor(ctx, R.color.w_blocked)
            state.sections.forEachIndexed { i, sec ->
                val head = RemoteViews(ctx.packageName, R.layout.widget_agenda_section)
                head.setTextViewText(R.id.s_label, sectionLabel(sec))
                if (sec.overdue) head.setTextColor(R.id.s_label, red)
                else if (sec.offset == 0) head.setTextColor(R.id.s_label, ContextCompat.getColor(ctx, R.color.w_accent))
                items.addItem(-(i + 1).toLong(), head)
                for (it in sec.items) items.addItem(it.id.hashCode().toLong() shl 8, row(ctx, it, sec.overdue, now, zone, red))
            }
            v.setRemoteAdapter(R.id.w_list, items.build())
            return v
        }

        private fun row(ctx: Context, it: AgendaItem, overdue: Boolean, now: Long, zone: ZoneId, red: Int): RemoteViews {
            val r = RemoteViews(ctx.packageName, R.layout.widget_agenda_row)
            r.setTextViewText(R.id.r_title, it.title)
            r.setTextViewText(R.id.r_project, it.project ?: "")
            r.setViewVisibility(R.id.r_project, if (it.project == null) View.GONE else View.VISIBLE)
            r.setTextViewText(R.id.r_meta, rowMeta(it, overdue, now, zone))
            r.setViewVisibility(R.id.r_repeat, if (it.recurring) View.VISIBLE else View.GONE)
            r.setViewVisibility(R.id.r_bell, if (it.hasReminder) View.VISIBLE else View.GONE)
            if (overdue) {
                r.setTextColor(R.id.r_meta, red)
                r.setColorStateList(R.id.r_check, "setButtonTintList", android.content.res.ColorStateList.valueOf(red))
            }
            r.setCompoundButtonChecked(R.id.r_check, false)
            val base = Intent().putExtra(WidgetTapActivity.EXTRA_ID, it.id)
            r.setOnClickFillInIntent(R.id.r_root, Intent(base).putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_OPEN))
            r.setOnCheckedChangeResponse(R.id.r_check, RemoteViews.RemoteResponse.fromFillInIntent(Intent(base)
                .putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_DONE)
                .putExtra(WidgetTapActivity.EXTRA_DUE, it.dueAt).putExtra(WidgetTapActivity.EXTRA_TITLE, it.title)
                .putExtra(WidgetTapActivity.EXTRA_ALL_DAY, it.allDay)))
            return r
        }

        fun ids(ctx: Context): IntArray = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, AgendaWidget::class.java))
    }
}
