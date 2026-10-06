package ro.horizontal.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import ro.horizontal.app.core.*
import java.io.File
import java.time.ZoneId
import java.util.UUID

/**
 * Foaia unui tichet, deschisă din widget-ul de agendă: nativă, peste ecranul de
 * start, fără WebView. ID · proiect și data se văd; titlul și descrierea se
 * editează și se salvează singure (800 ms de pauză și la orice închidere);
 * atașamentele se văd ca miniaturi și se deschid în aplicația telefonului.
 *
 * Primul cadru vine din ce știe deja telefonul (rândul din agendă); descrierea
 * și atașamentele, de pe server. Scrierile trec prin coada `edits` (`core/Edit.kt`),
 * trimisă de `DrainWorker` — doar câmpurile schimbate față de ce era pe server.
 * Fără descrierea de pe server (offline) descrierea nu se poate edita: o scriere
 * oarbă ar putea șterge textul scris pe alt dispozitiv.
 */
class TicketActivity : AppCompatActivity() {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var title: EditText
    private lateinit var desc: EditText
    private lateinit var note: TextView
    private lateinit var id: String
    /** Ultimele valori știute de pe server (sau trimise de noi): baza patch-ului. */
    private val base = mutableMapOf<String, String>()
    private var descLoaded = false
    private var titleDirty = false
    private var descDirty = false
    private var loading = false
    private val save = Runnable { flush() }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_ticket)
        title = findViewById(R.id.t_title)
        desc = findViewById(R.id.t_desc)
        note = findViewById(R.id.t_note)
        val sheet = findViewById<View>(R.id.sheet)
        val padBottom = sheet.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(sheet) { v, ins ->
            val bottom = maxOf(ins.getInsets(WindowInsetsCompat.Type.ime()).bottom, ins.getInsets(WindowInsetsCompat.Type.systemBars()).bottom)
            v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, padBottom + bottom); ins
        }
        findViewById<View>(R.id.scrim).setOnClickListener { flush(); finish() }
        title.setOnEditorActionListener { v, a, _ -> if (a == EditorInfo.IME_ACTION_DONE) { flush(); v.clearFocus(); true } else false }
        title.addTextChangedListener(watcher { if (!loading) { titleDirty = true; schedule() } })
        desc.addTextChangedListener(watcher { if (!loading) { descDirty = true; schedule() } })
        // Titlul se rupe pe rânduri, dar Enter îl încheie (textMultiLine din XML ar fi pus un rând nou în titlu).
        title.setRawInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
        open(intent)
    }

    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        flush()
        setIntent(i)
        open(i)
    }

    private fun open(i: Intent) {
        id = i.getStringExtra(EXTRA_ID) ?: return finish()
        base.clear(); descLoaded = false; titleDirty = false; descDirty = false
        // `singleTask`: aceeași instanță primește și tichetul următor — fără stări rămase de la cel dinainte.
        title.isEnabled = true; desc.isEnabled = true
        val project = i.getStringExtra(EXTRA_PROJECT)
        findViewById<TextView>(R.id.t_head).text = listOfNotNull(displayId(id), project).joinToString(" · ")
        val due = findViewById<TextView>(R.id.t_due)
        due.text = rawLabel(i.getStringExtra(EXTRA_DUE), i.getBooleanExtra(EXTRA_ALL_DAY, true), System.currentTimeMillis(), zone) ?: ""
        due.setCompoundDrawablesRelativeWithIntrinsicBounds(
            if (i.getBooleanExtra(EXTRA_RECURRING, false)) R.drawable.ic_widget_repeat else 0, 0,
            if (i.getBooleanExtra(EXTRA_REMINDER, false)) R.drawable.ic_widget_bell else 0, 0)
        val icons = due.compoundDrawablesRelative.map { d -> d?.mutate()?.apply { setBounds(0, 0, dp(13), dp(13)); setTint(getColor(R.color.hz_muted)) } }
        due.setCompoundDrawablesRelative(icons[0], null, icons[2], null)
        val agendaTitle = i.getStringExtra(EXTRA_TITLE) ?: ""
        setTexts(agendaTitle, null)
        base["title"] = agendaTitle
        paintFiles(emptyList())

        val s = PlanStore.read(this)
        val create = s.creates.firstOrNull { it.tempId == id || it.realId == id }
        // Un rând vechi din widget poate purta încă ID-ul provizoriu al unei sarcini deja trimise.
        if (create != null) id = create.id
        when {
            // Capturată pe telefon și încă nevăzută de server (sau abia trimisă): totul e aici,
            // cu editările încă netrimise peste ea.
            create != null -> {
                val pending = s.edits.filter { it.id == create.id || it.id == create.tempId }.fold(emptyMap<String, String>()) { a, e -> a + e.fields }
                val t = pending["title"] ?: create.title; val d = pending["details"] ?: create.desc
                setTexts(t, d)
                base["title"] = t; base["details"] = d; descLoaded = true
                paintFiles(create.files.map { Shown(it.filename, it.contentType, File(it.path)) })
                showNote(null)
            }
            // Creată offline în aplicație: numărul real îl știe doar pagina.
            NativeQueue.isTempId(id) -> { readOnly("Se sincronizează în aplicație — deschide-o o dată.") }
            else -> load()
        }
    }

    /** Descrierea și atașamentele, de pe server. Un răspuns venit după ce ai început să scrii nu-ți calcă textul. */
    private fun load() {
        desc.isEnabled = false
        showNote("Se încarcă…")
        val target = id
        Thread {
            val owner = NativeSession.lastAccount(this)
            val r = try { owner?.let { SupabaseApi.rest(this, "GET", "issues?id=eq.${enc(target)}&select=title,details", asUser = it) } } catch (e: Exception) { null }
            val row = r?.takeIf { it.status in 200..299 }?.let { JSONArray(it.body).optJSONObject(0) }
            val files = if (row != null && owner != null) loadFiles(target, owner) else emptyList()
            main.post {
                if (target != id || isFinishing) return@post
                if (row == null) {
                    showNote(if (r != null && r.status in 200..299) "Tichetul nu mai există." else "Descrierea cere rețea — titlul se poate schimba.")
                    return@post
                }
                val t = row.optString("title"); val d = if (row.isNull("details")) "" else row.optString("details")
                base["title"] = t; base["details"] = d; descLoaded = true
                setTexts(if (titleDirty) null else t, if (descDirty) null else d)
                desc.isEnabled = true
                showNote(null)
                paintFiles(files)
            }
        }.start()
    }

    private data class Shown(val name: String, val type: String, val file: File?, val url: String? = null)

    /** Rândurile din `attachments` + URL-uri semnate; pozele mici se descarcă pentru miniatură. */
    private fun loadFiles(issueId: String, owner: String): List<Shown> = try {
        val r = SupabaseApi.rest(this, "GET", "attachments?issue_id=eq.${enc(issueId)}&select=id,path,filename,content_type,size&order=created_at", asUser = owner)
        val a = r?.takeIf { it.status in 200..299 }?.let { JSONArray(it.body) } ?: JSONArray()
        val rows = (0 until a.length()).map { a.getJSONObject(it) }
        val urls = if (rows.isEmpty()) emptyMap() else SupabaseApi.signStorage(this, rows.map { it.getString("path") }, owner).orEmpty()
        val dir = File(cacheDir, "attach").apply { mkdirs() }
        rows.map { o ->
            val type = if (o.isNull("content_type")) "application/octet-stream" else o.getString("content_type")
            val f = File(dir, "${o.getString("id")}-${o.getString("filename").replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(60)}")
            val url = urls[o.getString("path")]
            // Obiectele sunt imuabile (ID nou la fiecare urcare): ID-ul e o cheie de cache permanentă.
            if (!f.exists() && url != null && type.startsWith("image/") && !type.contains("svg") && o.optLong("size") <= 10_000_000) {
                try { SupabaseApi.download(url, f) } catch (e: Exception) {}
            }
            Shown(o.getString("filename"), type, f.takeIf { it.exists() }, url)
        }
    } catch (e: Exception) { emptyList() }

    private fun paintFiles(files: List<Shown>) {
        val row = findViewById<LinearLayout>(R.id.t_files)
        row.removeAllViews()
        findViewById<View>(R.id.t_files_scroll).visibility = if (files.isEmpty()) View.GONE else View.VISIBLE
        for (f in files) {
            val iv = ImageView(this)
            iv.layoutParams = LinearLayout.LayoutParams(dp(72), dp(72)).apply { marginEnd = dp(8) }
            iv.scaleType = ImageView.ScaleType.CENTER_CROP
            iv.setBackgroundResource(R.drawable.bg_chip)
            iv.clipToOutline = true
            val thumb = f.file?.takeIf { f.type.startsWith("image/") }?.let { decodeThumb(it) }
            if (thumb != null) iv.setImageBitmap(thumb) else { iv.setImageResource(R.drawable.ic_q_attach); iv.setPadding(dp(22), dp(22), dp(22), dp(22)) }
            iv.contentDescription = f.name
            iv.setOnClickListener { openFile(f) }
            row.addView(iv)
        }
    }

    private fun decodeThumb(f: File) = try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var s = 1
        while (o.outWidth / (s * 2) >= dp(144) && o.outHeight / (s * 2) >= dp(144)) s *= 2
        BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
    } catch (e: Throwable) { null }

    /** În aplicația telefonului (galerie, PDF…), prin FileProvider. Un fișier nedescărcat se descarcă întâi. */
    private fun openFile(f: Shown) {
        val show = { file: File ->
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            try { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, f.type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
            catch (e: ActivityNotFoundException) { Toast.makeText(this, "Nicio aplicație nu deschide „${f.name}”", Toast.LENGTH_SHORT).show() }
        }
        f.file?.let { show(it); return }
        val url = f.url ?: return
        Toast.makeText(this, "Se descarcă…", Toast.LENGTH_SHORT).show()
        Thread {
            val out = File(File(cacheDir, "attach").apply { mkdirs() }, "${UUID.randomUUID()}-${f.name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(60)}")
            val ok = try { SupabaseApi.download(url, out) } catch (e: Exception) { false }
            main.post { if (ok) show(out) else Toast.makeText(this, "Fișierul cere rețea", Toast.LENGTH_SHORT).show() }
        }.start()
    }

    private fun schedule() { main.removeCallbacks(save); main.postDelayed(save, 800) }

    /** Doar ce s-a schimbat față de server; descrierea numai dacă a fost citită de acolo. */
    private fun flush() {
        main.removeCallbacks(save)
        if (!::id.isInitialized || NativeQueue.isTempId(id) && PlanStore.read(this).creates.none { it.tempId == id }) return
        val draft = buildMap {
            put("title", title.text.toString())
            if (descLoaded) put("details", desc.text.toString())
        }
        val patch = patchOf(draft, base)
        if (patch.isEmpty()) return
        val e = NativeEdit(UUID.randomUUID().toString(), id, patch, System.currentTimeMillis())
        PlanStore.edit(this) { s -> val (cs, es) = applyEdit(s.creates, s.edits, e); s.copy(creates = cs, edits = es) to Unit }
        base.putAll(patch)
        Widgets.refresh(this)
        DrainWorker.enqueue(this)
    }

    override fun onPause() { super.onPause(); flush() }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, android.R.anim.fade_out)
    }

    private fun readOnly(msg: String) { title.isEnabled = false; desc.isEnabled = false; showNote(msg) }

    private fun setTexts(t: String?, d: String?) {
        loading = true
        try { t?.let { title.setText(it) }; d?.let { desc.setText(it) } } finally { loading = false }
    }

    private fun showNote(s: String?) { note.visibility = if (s == null) View.GONE else View.VISIBLE; note.text = s ?: "" }
    private fun displayId(id: String) = id.indexOf("-~").let { if (it < 0) id else id.substring(0, it) + "-·" }
    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun watcher(f: () -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: Editable?) = f()
    }

    companion object {
        const val EXTRA_ID = "id"; const val EXTRA_TITLE = "title"; const val EXTRA_DUE = "dueAt"; const val EXTRA_ALL_DAY = "allDay"
        const val EXTRA_PROJECT = "project"; const val EXTRA_REMINDER = "reminder"; const val EXTRA_RECURRING = "recurring"
    }
}
