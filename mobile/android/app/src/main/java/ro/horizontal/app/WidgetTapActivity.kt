package ro.horizontal.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import ro.horizontal.app.core.NativeAction
import java.util.UUID

/**
 * Atingere pe un rând al agendei: fără interfață, se închide imediat. „Gata" pune
 * acțiunea în coada nativă (aceeași ca butonul din notificare, cu garda pe
 * `prevDueAt`); fără sesiune nativă n-ar pleca niciodată, deci deschide tichetul.
 */
class WidgetTapActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra(EXTRA_ID)
        if (id != null) when {
            intent.getStringExtra(EXTRA_KIND) == KIND_DONE && NativeSession.isSignedIn(this) ->
                Actions.dispatch(this, NativeAction(
                    uid = UUID.randomUUID().toString(), kind = NativeAction.Kind.DONE, id = id,
                    prevDueAt = intent.getStringExtra(EXTRA_DUE), title = intent.getStringExtra(EXTRA_TITLE) ?: "", body = "",
                    allDay = intent.getBooleanExtra(EXTRA_ALL_DAY, false), createdAt = System.currentTimeMillis(),
                ))
            // Atingerea pe rând: foaia nativă a tichetului (peste ecranul de start). Fără sesiune
            // nativă n-ar avea cu ce citi sau salva — atunci aplicația, unde se face login-ul.
            intent.getStringExtra(EXTRA_KIND) == KIND_OPEN && NativeSession.isSignedIn(this) ->
                startActivity(Intent(this, TicketActivity::class.java).putExtras(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            else -> {
                startActivity(Intent(this, MainActivity::class.java).putExtra(Widgets.EXTRA_OPEN, id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP))
                // Launcher-ul a bifat căsuța local; fără o redesenare ar rămâne bifată, deși nimic nu s-a făcut.
                Widgets.refresh(this)
            }
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }

    companion object {
        const val EXTRA_KIND = "kind"; const val EXTRA_ID = "id"; const val EXTRA_DUE = "dueAt"
        const val EXTRA_TITLE = "title"; const val EXTRA_ALL_DAY = "allDay"
        const val KIND_DONE = "done"; const val KIND_OPEN = "open"
    }
}
