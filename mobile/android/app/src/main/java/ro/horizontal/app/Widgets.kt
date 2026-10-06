package ro.horizontal.app

import android.content.Context

/** Widget-urile de pe ecranul de start. Corpul lui `refresh` vine cu desenul. */
object Widgets {
    /** Atingere pe un rând: MainActivity deschide tichetul. Altul decât `Notifier.EXTRA_OPEN`: pagina știe că vine din widget. */
    const val EXTRA_OPEN = "hz-widget-open"
    const val EXTRA_QUICK = "hz-widget-quick"

    fun refresh(ctx: Context) {}
}
