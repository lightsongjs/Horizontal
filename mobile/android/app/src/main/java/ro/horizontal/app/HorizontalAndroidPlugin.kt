package ro.horizontal.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import ro.horizontal.app.core.*

/**
 * Puntea către pagină. Contractul e `HorizontalAndroidPlugin` din
 * `src/lib/androidBridge.ts` — același contract, scris de două ori; se schimbă
 * împreună. `API` crește când pagina are nevoie de o metodă nouă: pagina citește
 * `api` și, dacă cutia e prea veche, spune „actualizează aplicația" în loc să
 * cheme o metodă care nu există.
 */
@CapacitorPlugin(
    name = "HorizontalAndroid",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class HorizontalAndroidPlugin : Plugin() {
    override fun load() {
        instance = this
        handleOpen(activity.intent)
        Engine.reschedule(context)   // deschiderea aplicației repune alarmele (MIUI le șterge la oprire forțată)
    }

    override fun handleOnNewIntent(intent: Intent) { handleOpen(intent) }

    override fun handleOnDestroy() { if (instance === this) instance = null }

    /** Atingere pe notificare sau pe widget. `retain`: la pornire la rece pagina încă n-a pus listenerul. */
    private fun handleOpen(intent: Intent?) {
        // Relansată din Recente, activitatea primește intentul ORIGINAL al sarcinii —
        // `removeExtra` de mai jos nu supraviețuiește morții procesului, deci după o
        // repornire tichetul atins cândva pe notificare s-ar redeschide singur.
        if (intent == null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        intent.getStringExtra(Notifier.EXTRA_OPEN)?.let { id ->
            intent.removeExtra(Notifier.EXTRA_OPEN)
            notifyListeners("reminderAction", JSObject().put("action", "open").put("id", id), true)
            return
        }
        intent.getStringExtra(Widgets.EXTRA_OPEN)?.let { id ->
            intent.removeExtra(Widgets.EXTRA_OPEN)
            notifyListeners("widget", JSObject().put("kind", "open").put("id", id), true)
            return
        }
        if (intent.getBooleanExtra(Widgets.EXTRA_QUICK, false)) {
            intent.removeExtra(Widgets.EXTRA_QUICK)
            notifyListeners("widget", JSObject().put("kind", "quick"), true)
        }
    }

    @PluginMethod fun getInfo(call: PluginCall) { call.resolve(JSObject().put("version", BuildConfig.VERSION_NAME).put("api", API)) }

    @PluginMethod fun setReminders(call: PluginCall) {
        val list = call.getArray("list", JSArray())!!
        val held = call.getArray("heldIds", JSArray())!!
        // `optLong`, nu `call.getLong`: acela întoarce valoarea doar dacă JSON-ul a
        // parsat-o ca `Long` — un `readAt: 0` (pagina offline) vine `Integer` și ar
        // cădea pe implicit din întâmplare, nu din regulă.
        val readAt = call.data.optLong("readAt", 0L)
        val reminders = (0 until list.length()).mapNotNull { Json.reminderFromJson(list.getJSONObject(it)) }
        val heldIds = (0 until held.length()).map { held.getString(it) }.toSet()
        PlanStore.edit(context) { s -> s.copy(page = PageList(reminders, heldIds, readAt)) to Unit }
        Engine.reschedule(context)
        call.resolve()
    }

    @PluginMethod fun setAgenda(call: PluginCall) {
        val items = call.getArray("items", JSArray())!!
        val readAt = call.data.optLong("readAt", 0L)   // `optLong`: vezi `setReminders`
        val list = AgendaList((0 until items.length()).mapNotNull { Json.agendaItemFromJson(items.getJSONObject(it)) }, readAt)
        PlanStore.edit(context) { s -> s.copy(agendaPage = list) to Unit }
        Widgets.refresh(context)
        call.resolve()
    }

    /** Pagina a închis ce deschisese widget-ul: omul se întoarce pe ecranul de start, nu pe alt ecran al aplicației. */
    @PluginMethod fun leave(call: PluginCall) {
        activity?.runOnUiThread { activity?.moveTaskToBack(true) }
        call.resolve()
    }

    /**
     * Tastatura pentru foaia rapidă deschisă din widget: focusul din pagină nu
     * vine dintr-un gest în pagină, iar WebView-ul poate refuza să o ridice.
     */
    @PluginMethod fun showKeyboard(call: PluginCall) {
        activity?.runOnUiThread {
            val web = bridge?.webView ?: return@runOnUiThread
            web.requestFocus()
            (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
        }
        call.resolve()
    }

    @PluginMethod fun takeActions(call: PluginCall) {
        val now = System.currentTimeMillis()
        val taken = PlanStore.edit(context) { s -> val (t, rest) = NativeQueue.take(s.queue, now); s.copy(queue = rest) to t }
        call.resolve(JSObject().put("actions", JSArray().also { a -> taken.forEach { a.put(Json.actionToPage(it)) } }))
    }

    @PluginMethod fun status(call: PluginCall) {
        val s = PlanStore.read(context)
        val pm = context.getSystemService(PowerManager::class.java)
        call.resolve(JSObject()
            .put("notifications", notifState())
            .put("exactAlarms", AlarmScheduler.canExact(context))
            .put("exactUsed", s.exactUsed)
            .put("batteryOptimized", !pm.isIgnoringBatteryOptimizations(context.packageName))
            .put("manufacturer", Build.MANUFACTURER)
            .put("session", sessionState())
            .put("lastSyncAt", s.lastSyncAt?.let(::isoJs) ?: JSONObject.NULL)
            .put("nextAlarmAt", s.nextAlarmAt?.let(::isoJs) ?: JSONObject.NULL)
            .put("queued", NativeQueue.pending(s.queue)))
    }

    /** Ieftin, fără rețea: o sesiune moartă se descoperă la primul refresh și își șterge singură cutia. */
    private fun sessionState(): String = if (NativeSession.isSignedIn(context)) "ok" else "missing"

    @PluginMethod fun signIn(call: PluginCall) {
        val url = call.getString("url"); val anon = call.getString("anonKey"); val email = call.getString("email"); val pw = call.getString("password")
        if (url == null || anon == null || email == null || pw == null) return call.reject("lipsesc câmpuri")
        // Rețea: nu pe firul principal.
        Thread {
            try { NativeSession.signIn(context, url, anon, email, pw); Hooks.afterQueued(context); call.resolve() }
            catch (e: Exception) { call.reject(e.message ?: "login nativ eșuat") }
        }.start()
    }

    @PluginMethod fun signOut(call: PluginCall) {
        // `finally`: pagina așteaptă răspunsul la logout; un apel rămas fără răspuns ar atârna deconectarea.
        // Widget-ul trece pe „Deschide aplicația": agenda contului vechi a plecat odată cu planul.
        Thread { try { NativeSession.signOut(context) } finally { Widgets.refresh(context); call.resolve() } }.start()
    }

    private fun notifState(): String = when {
        NotificationManagerCompat.from(context).areNotificationsEnabled() -> "granted"
        // PROMPT_WITH_RATIONALE = refuzat o dată, dar sistemul încă afișează dialogul: tot „se poate cere".
        Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications").let { it == PermissionState.PROMPT || it == PermissionState.PROMPT_WITH_RATIONALE } -> "prompt"
        else -> "denied"
    }

    @PluginMethod fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || notifState() == "granted") { call.resolve(JSObject().put("notifications", notifState())); return }
        requestPermissionForAlias("notifications", call, "onNotifPermission")
    }

    @PermissionCallback private fun onNotifPermission(call: PluginCall) { call.resolve(JSObject().put("notifications", notifState())) }

    @PluginMethod fun openSettings(call: PluginCall) {
        val pkg = context.packageName
        val i = when (call.getString("kind")) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "exact-alarms" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg")) else null
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else -> null
        } ?: return call.reject("necunoscut")
        // Unii producători scot ecranele de setări (ex. optimizarea bateriei); fără catch,
        // excepția ar omorî apelul fără răspuns, iar pagina ar aștepta la nesfârșit.
        try { activity.startActivity(i) } catch (e: ActivityNotFoundException) { return call.reject("ecranul de setări lipsește pe acest telefon") }
        call.resolve()
    }

    companion object {
        // 2: setAgenda, leave, showKeyboard, evenimentul „widget" (widget-urile).
        const val API = 2
        @Volatile private var instance: HorizontalAndroidPlugin? = null

        /**
         * Pagina e executantul preferat doar când e VIZIBILĂ: în fundal JS-ul
         * WebView-ului poate fi oprit oricând, iar o acțiune predată unei pagini
         * care nu mai rulează s-ar pierde. Fără listener (pagina încă se încarcă)
         * — tot coada.
         */
        fun deliverIfVisible(data: JSONObject): Boolean {
            val p = instance ?: return false
            val act = p.activity ?: return false
            if (!act.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return false
            if (!p.hasListeners("reminderAction")) return false
            p.notifyListeners("reminderAction", JSObject.fromJSONObject(data))
            return true
        }

        /** Cutia a schimbat ceva pe server; pagina, dacă rulează, își reîmprospătează datele. */
        fun notifyChanged() { instance?.notifyListeners("changed", JSObject()) }
    }
}
