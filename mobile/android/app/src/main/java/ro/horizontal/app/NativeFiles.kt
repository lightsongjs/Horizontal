package ro.horizontal.app

import android.content.Context
import ro.horizontal.app.core.NativeFile

/** Atașamentele ferestrei de quick add. Corpul vine cu pasul de atașamente. */
object NativeFiles {
    fun pick(a: QuickAddActivity) {}
    fun canSend(ctx: Context): Boolean = true
    fun take(ctx: Context, projectId: String): List<NativeFile> = emptyList()
}
