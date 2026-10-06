package ro.horizontal.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Butonul 1×1: deschide foaia rapidă. Nu citește nicio stare. */
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
        v.setOnClickPendingIntent(R.id.q_root, Widgets.quick(ctx))
        mgr.updateAppWidget(ids, v)
    }
}
