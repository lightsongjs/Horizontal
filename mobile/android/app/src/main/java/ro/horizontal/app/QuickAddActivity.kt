package ro.horizontal.app

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.os.Bundle
import android.text.Editable
import android.text.Spannable
import android.text.TextWatcher
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import ro.horizontal.app.core.*
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * Fereastra de quick add de pe ecranul de start: nativă, peste ce e pe ecran,
 * cu tastatura sus — fără să pornească aplicația (WebView-ul). Regulile de
 * captură (data din titlu, `#proiect @om !`, proiectul implicit Daily) sunt ale
 * paginii: `computeDraft`, rulat în `CaptureEngine`. Fără motor → modul brut.
 *
 * Trimite pune sarcina în coada nativă (`PlanStore.creates`); o trimite
 * `DrainWorker`, cu rețea. Sarcina apare imediat în widget.
 */
class QuickAddActivity : AppCompatActivity() {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private lateinit var title: EditText
    private lateinit var desc: EditText
    private lateinit var note: TextView
    private var data: CaptureData? = null
    private val rejected = mutableListOf<String>()
    private var manual = Manual()
    private var draft: Draft? = null
    private var seq = 0
    private var sent = false
    private var keyboardShown = false
    private var painting = false

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_quick)
        CaptureEngine.warm(this)
        title = findViewById(R.id.q_title)
        desc = findViewById(R.id.q_desc)
        note = findViewById(R.id.q_note)
        data = PlanStore.read(this).capture?.takeIf { it.projects.isNotEmpty() }

        // Edge-to-edge (targetSdk 36): tastatura și bara de navigare nu mai micșorează
        // fereastra — foaia se ridică singură cu cât acoperă ele.
        val sheet = findViewById<View>(R.id.sheet)
        val padBottom = sheet.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(sheet) { v, ins ->
            val bottom = maxOf(ins.getInsets(WindowInsetsCompat.Type.ime()).bottom, ins.getInsets(WindowInsetsCompat.Type.systemBars()).bottom)
            v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, padBottom + bottom); ins
        }
        findViewById<View>(R.id.scrim).setOnClickListener { finish() }

        restoreDraft(b)
        title.addTextChangedListener(watcher { if (!painting) recompute() })
        title.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { submit(); true } else false }
        title.setOnTouchListener { _, e -> e.action == MotionEvent.ACTION_DOWN && rejectAt(e) }
        findViewById<View>(R.id.q_send).setOnClickListener { submit() }
        findViewById<View>(R.id.q_due).setOnClickListener { pickDue() }
        findViewById<View>(R.id.q_project).setOnClickListener { pickProject() }
        findViewById<View>(R.id.q_person).setOnClickListener { pickPerson() }
        findViewById<View>(R.id.q_urgent).setOnClickListener {
            manual = manual.copy(urgent = !(draft?.urgent ?: false)); recompute()
        }
        findViewById<View>(R.id.q_attach).setOnClickListener { NativeFiles.pick(this) }

        if (data == null) {
            showNote("Deschide aplicația o dată, ca fereastra să știe proiectele.")
            findViewById<View>(R.id.q_send).isEnabled = false
        }
        // Primul cadru, fără să aștepte motorul: jetoanele arată ceva din clipa deschiderii.
        data?.let { apply(rawDraft(title.text.toString(), manual, it, System.currentTimeMillis(), zone).copy(raw = false)) }
        recompute()
    }

    /** Tastatura se cere după ce fereastra are focusul: HyperOS ignoră o cerere mai timpurie. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || keyboardShown) return
        keyboardShown = true
        title.requestFocus()
        title.setSelection(title.text.length)
        WindowInsetsControllerCompat(window, title).show(WindowInsetsCompat.Type.ime())
    }

    private fun recompute() {
        val d = data ?: return
        val my = ++seq
        val text = title.text.toString()
        val input = engineInput(text, desc.text.toString(), rejected, manual, d, dailyProjectId(d.projects), System.currentTimeMillis())
        CaptureEngine.compute(this, input) { r ->
            if (my != seq || isFinishing) return@compute
            apply(r ?: rawDraft(text, manual, d, System.currentTimeMillis(), zone))
        }
    }

    /** Desenează rezultatul: evidențierea datei în titlu, jetoanele, nota. */
    private fun apply(d: Draft) {
        draft = d
        if (!d.raw) { rejected.clear(); rejected.addAll(d.live) }
        paintMarks(d.spans)
        val chipText = { id: Int, s: String -> findViewById<TextView>(id).text = s }
        chipText(R.id.q_due, d.label ?: "Fără dată")
        chipText(R.id.q_project, data?.projects?.firstOrNull { it.id == d.projectId }?.name ?: "Proiect")
        val person = data?.people?.firstOrNull { it.id == d.assigneeId }?.name
        chipText(R.id.q_person, person ?: "")
        findViewById<TextView>(R.id.q_person).compoundDrawablePadding = if (person == null) 0 else dp(6)
        val urgent = findViewById<TextView>(R.id.q_urgent)
        urgent.setBackgroundResource(if (d.urgent) R.drawable.bg_chip_on else R.drawable.bg_chip)
        urgent.compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color(if (d.urgent) R.color.hz_accent else R.color.hz_muted))
        when {
            data == null -> {}
            d.raw -> showNote("Recunoașterea datei e indisponibilă acum: alege data din jeton.")
            d.unknown.isNotEmpty() -> showNote("${d.unknown.joinToString(", ")} nu e un proiect sau un om — rămâne în titlu.")
            else -> showNote(null)
        }
    }

    private class DateMark(c: Int) : BackgroundColorSpan(c)
    private class DateInk(c: Int) : ForegroundColorSpan(c)

    private fun paintMarks(spans: List<IntRange>) {
        painting = true
        try { paint(spans) } finally { painting = false }
    }

    private fun paint(spans: List<IntRange>) {
        val t = title.text
        t.getSpans(0, t.length, DateMark::class.java).forEach { t.removeSpan(it) }
        t.getSpans(0, t.length, DateInk::class.java).forEach { t.removeSpan(it) }
        for (r in spans) {
            if (r.first < 0 || r.last + 1 > t.length) continue
            t.setSpan(DateMark(color(R.color.hz_mark)), r.first, r.last + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            t.setSpan(DateInk(color(R.color.hz_accent)), r.first, r.last + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    /**
     * Atingerea pe un fragment evidențiat îl refuză („Ședință la Podul 5" rămâne
     * text), ca în pagină. E o comandă, nu o poziționare de cursor: evenimentul
     * se consumă, iar cursorul merge la capăt, de unde se scrie mai departe.
     */
    private fun rejectAt(e: MotionEvent): Boolean {
        val spans = draft?.spans.orEmpty()
        val layout = title.layout ?: return false
        if (spans.isEmpty()) return false
        val x = e.x - title.totalPaddingLeft + title.scrollX
        val y = e.y - title.totalPaddingTop + title.scrollY
        val line = layout.getLineForVertical(y.toInt())
        val off = layout.getOffsetForHorizontal(line, x)
        val hit = spans.firstOrNull { r ->
            off in r.first..r.last + 1 && layout.getLineForOffset(r.first) <= line && line <= layout.getLineForOffset(r.last + 1) &&
                x >= minOf(layout.getPrimaryHorizontal(r.first), layout.getPrimaryHorizontal(r.last + 1)) - 4 &&
                x <= maxOf(layout.getPrimaryHorizontal(r.first), layout.getPrimaryHorizontal(r.last + 1)) + 4
        } ?: return false
        val text = title.text.toString()
        rejected += text.substring(hit.first, hit.last + 1)
        if (!text.last().isWhitespace()) title.append(" ") else recompute()
        title.setSelection(title.text.length)
        return true
    }

    private fun pickDue() {
        val today = LocalDate.now(zone)
        val dlg = DatePickerDialog(this, { _, y, m, d ->
            val day = LocalDate.of(y, m + 1, d)
            val tp = TimePickerDialog(this, { _, h, min -> setDue(manualDue(day, LocalTime.of(h, min), zone)) }, 9, 0, true)
            tp.setButton(android.content.DialogInterface.BUTTON_NEUTRAL, "Toată ziua") { _, _ -> setDue(manualDue(day, null, zone)) }
            tp.show()
        }, today.year, today.monthValue - 1, today.dayOfMonth)
        dlg.setButton(android.content.DialogInterface.BUTTON_NEUTRAL, "Fără dată") { _, _ -> setDue(null to true) }
        dlg.show()
    }

    private fun setDue(v: Pair<String?, Boolean>) { manual = manual.copy(dueSet = true, dueAt = v.first, allDay = v.second); recompute() }

    private fun pickProject() {
        val ps = data?.projects ?: return
        AlertDialog.Builder(this).setTitle("Proiect").setItems(ps.map { it.name }.toTypedArray()) { _, i ->
            manual = manual.copy(projectId = ps[i].id); recompute()
        }.show()
    }

    private fun pickPerson() {
        val people = data?.people ?: return
        AlertDialog.Builder(this).setTitle("Al cui e").setItems((listOf("Al meu") + people.map { it.name }).toTypedArray()) { _, i ->
            manual = manual.copy(assigneeSet = true, assigneeId = if (i == 0) null else people[i - 1].id); recompute()
        }.show()
    }

    private fun submit() {
        val d = data ?: return
        if (sent) return
        val text = title.text.toString()
        // Rezultatul final pe textul de ACUM (ultima tastă poate fi încă la motor).
        val my = ++seq
        CaptureEngine.compute(this, engineInput(text, desc.text.toString(), rejected, manual, d, dailyProjectId(d.projects), System.currentTimeMillis())) { r ->
            if (my != seq || sent || isFinishing) return@compute
            val f = r ?: rawDraft(text, manual, d, System.currentTimeMillis(), zone)
            apply(f)
            when (f.error) {
                "empty" -> return@compute
                "bare" -> { showNote("Ai scris doar data — scrie și ce ai de făcut."); return@compute }
            }
            if (!NativeFiles.canSend(this)) {
                showNote("Fără rețea: fișierele nu pot pleca acum. Scoate-le sau încearcă din nou.")
                return@compute
            }
            val project = d.projects.firstOrNull { it.id == f.projectId } ?: return@compute
            sent = true
            val uid = UUID.randomUUID().toString()
            val create = NativeCreate(
                uid = uid, tempId = "${project.prefix}-~${uid.replace("-", "").take(6)}", projectId = project.id, projectName = project.name,
                title = f.title, desc = desc.text.toString().trim(), dueAt = f.dueAt, allDay = f.allDay, remindAt = f.remindAt,
                rrule = f.rrule, urgent = f.urgent, assigneeId = f.assigneeId, createdAt = System.currentTimeMillis(),
                files = NativeFiles.take(this, project.id),
            )
            PlanStore.edit(this) { s -> s.copy(creates = s.creates + create) to Unit }
            Engine.reschedule(this)   // mementoul și widget-ul, imediat
            DrainWorker.enqueue(this)
            getSharedPreferences(DRAFT, 0).edit().clear().apply()
            finish()
        }
    }

    // ── ciorna: Back, voalul sau o cameră care omoară procesul nu aruncă ce ai scris ──

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        out.putStringArrayList("rejected", ArrayList(rejected))
    }

    override fun onPause() {
        super.onPause()
        if (sent) return
        getSharedPreferences(DRAFT, 0).edit()
            .putString("title", title.text.toString()).putString("desc", desc.text.toString())
            .putString("rejected", JSONArray(rejected).toString()).apply()
    }

    private fun restoreDraft(b: Bundle?) {
        val p = getSharedPreferences(DRAFT, 0)
        title.setText(p.getString("title", ""))
        desc.setText(p.getString("desc", ""))
        val saved = b?.getStringArrayList("rejected")
            ?: p.getString("rejected", null)?.let { j -> JSONArray(j).let { a -> (0 until a.length()).map { a.getString(it) } } }
        saved?.let { rejected.addAll(it) }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) CaptureEngine.close()
    }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, android.R.anim.fade_out)
    }

    private fun showNote(s: String?) {
        note.visibility = if (s == null) View.GONE else View.VISIBLE
        note.text = s ?: ""
    }

    private fun color(id: Int) = ContextCompat.getColor(this, id)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun watcher(f: () -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: Editable?) = f()
    }

    companion object {
        private const val DRAFT = "hz-quick-draft"
        fun clearDraft(ctx: Context) = ctx.getSharedPreferences(DRAFT, 0).edit().clear().apply()
    }
}
