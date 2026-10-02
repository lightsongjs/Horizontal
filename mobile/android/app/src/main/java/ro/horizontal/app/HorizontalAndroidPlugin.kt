package ro.horizontal.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Puntea către pagină. Contractul e `HorizontalAndroidPlugin` din
 * `src/lib/androidBridge.ts` — același contract, scris de două ori; se schimbă
 * împreună. `API` crește când pagina are nevoie de o metodă nouă: pagina citește
 * `api` și, dacă cutia e prea veche, spune „actualizează aplicația" în loc să
 * cheme o metodă care nu există.
 */
@CapacitorPlugin(name = "HorizontalAndroid")
class HorizontalAndroidPlugin : Plugin() {
    @PluginMethod
    fun getInfo(call: PluginCall) {
        call.resolve(JSObject().put("version", BuildConfig.VERSION_NAME).put("api", API))
    }

    companion object {
        const val API = 1
    }
}
