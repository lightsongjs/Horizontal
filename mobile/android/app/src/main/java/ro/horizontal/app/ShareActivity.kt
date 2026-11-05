package ro.horizontal.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Ținta din meniul „Distribuie" al altor aplicații (YouTube, Chrome…). Fără UI:
 * dă textul ferestrei de quick add și dispare. Separată de `QuickAddActivity`,
 * ca aceea să rămână neexportată — orice aplicație poate deschide ținta asta,
 * dar ea doar umple un câmp; trimiterea rămâne a omului.
 */
class ShareActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (intent?.action == Intent.ACTION_SEND) {
            startActivity(Intent(this, QuickAddActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(QuickAddActivity.EXTRA_SHARED_TEXT, intent.getStringExtra(Intent.EXTRA_TEXT))
                .putExtra(QuickAddActivity.EXTRA_SHARED_SUBJECT, intent.getStringExtra(Intent.EXTRA_SUBJECT)))
        }
        finish()
    }
}
