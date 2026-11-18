package ro.horizontal.app

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.WindowCompat
import java.io.File
import kotlin.math.abs
import kotlin.math.min

/**
 * Pozele unui tichet pe tot ecranul, ÎN aplicație — ca `Lightbox.tsx` din pagină,
 * nu prin `ACTION_VIEW` (care pe telefon întreabă „cu ce aplicație?"). Primește
 * toate imaginile și indexul: glisat stânga/dreapta = următoarea, ciupit și
 * dublu-tap = mărire, tras cu un deget cât e mărită, atingere / Înapoi = închis.
 *
 * O poză fără fișier local (prea mare pentru miniatură) se descarcă la vedere,
 * prin `fetch`; decodarea e eșantionată la ecran, ca o poză de 12 MP să nu
 * umple memoria.
 */
class ImageViewer(
    private val ctx: Context,
    private val items: List<Item>,
    start: Int,
    /** Fișierul local al unei poze (descărcat dacă trebuie), pe un fir de lucru. `null` = nu se poate. */
    private val fetch: (Item) -> File?,
) {
    data class Item(val name: String, val file: File?, val url: String?)

    private val main = Handler(Looper.getMainLooper())
    private var index = start.coerceIn(0, items.lastIndex)
    private val dialog = Dialog(ctx, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
    private val image = ZoomView(ctx)
    private val status = TextView(ctx)
    private val counter = TextView(ctx)

    @SuppressLint("SetTextI18n")
    fun show() {
        val root = FrameLayout(ctx).apply { setBackgroundColor(Color.BLACK) }
        root.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        status.setTextColor(0xCCFFFFFF.toInt())
        root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        counter.setTextColor(0xCCFFFFFF.toInt())
        counter.setPadding(dp(16), dp(16), dp(16), dp(16))
        root.addView(counter, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        val close = ImageView(ctx).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setColorFilter(Color.WHITE)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            contentDescription = "Închide"
            setOnClickListener { dialog.dismiss() }
        }
        root.addView(close, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.TOP or Gravity.END))
        // Sub bara de stare (fereastra e pe tot ecranul): contorul și X-ul coboară cu ea.
        root.setOnApplyWindowInsetsListener { _, ins ->
            @Suppress("DEPRECATION") val top = ins.systemWindowInsetTop
            (close.layoutParams as FrameLayout.LayoutParams).topMargin = top
            (counter.layoutParams as FrameLayout.LayoutParams).topMargin = top
            close.requestLayout(); counter.requestLayout(); ins
        }
        image.onTap = { dialog.dismiss() }
        image.onSwipe = { dir -> go(index + dir) }
        dialog.setContentView(root)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.BLACK))
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            WindowCompat.setDecorFitsSystemWindows(this, false)
        }
        dialog.setOnDismissListener { main.removeCallbacksAndMessages(null); image.setBitmap(null) }
        dialog.show()
        go(index)
    }

    private fun go(i: Int) {
        if (i !in items.indices) return
        index = i
        val item = items[i]
        counter.text = if (items.size > 1) "${i + 1} / ${items.size}" else ""
        image.setBitmap(null)
        status.text = "Se încarcă…"; status.visibility = View.VISIBLE
        val w = ctx.resources.displayMetrics.widthPixels; val h = ctx.resources.displayMetrics.heightPixels
        Thread {
            val bmp = fetch(item)?.let { decode(it, w, h) }
            main.post {
                if (index != i || !dialog.isShowing) return@post
                if (bmp == null) { status.text = "Poza cere rețea" } else { status.visibility = View.GONE; image.setBitmap(bmp) }
            }
        }.start()
    }

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    companion object {
        /** Eșantionată la ~2× ecranul (loc de mărire), întoarsă după EXIF. */
        fun decode(f: File, w: Int, h: Int): Bitmap? = try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.path, o)
            var s = 1
            while (o.outWidth / (s * 2) >= w * 2 || o.outHeight / (s * 2) >= h * 2) s *= 2
            val raw = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
            raw?.let { NativeFiles.rotateByExif(f.path, it) }
        } catch (e: Throwable) { null }
    }

    /** Imaginea încăpută în ecran; ciupit, dublu-tap (încape ↔ 2,5×), tras cât e mărită, glisat când nu e. */
    private class ZoomView(ctx: Context) : View(ctx) {
        var onTap: () -> Unit = {}
        var onSwipe: (Int) -> Unit = {}
        private var bmp: Bitmap? = null
        private val m = Matrix()
        private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        private var fit = 1f
        private var scale = 1f
        private var tx = 0f; private var ty = 0f

        fun setBitmap(b: Bitmap?) { bmp = b; reset(); invalidate() }

        private fun reset() {
            val b = bmp ?: return
            if (width == 0 || height == 0) return
            fit = min(width.toFloat() / b.width, height.toFloat() / b.height)
            scale = fit
            tx = (width - b.width * scale) / 2; ty = (height - b.height * scale) / 2
        }

        override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) { reset() }

        private val zoomed get() = scale > fit * 1.01f

        /** Marginile: mărită, nu lasă fâșii goale; mai mică decât ecranul, rămâne centrată. */
        private fun clamp() {
            val b = bmp ?: return
            val w = b.width * scale; val h = b.height * scale
            tx = if (w <= width) (width - w) / 2 else tx.coerceIn(width - w, 0f)
            ty = if (h <= height) (height - h) / 2 else ty.coerceIn(height - h, 0f)
        }

        private fun zoomAt(next: Float, px: Float, py: Float) {
            val s = next.coerceIn(fit, fit * 6)
            tx = px - (px - tx) * (s / scale); ty = py - (py - ty) * (s / scale)
            scale = s; clamp(); invalidate()
        }

        private val pinch = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(d: ScaleGestureDetector): Boolean { zoomAt(scale * d.scaleFactor, d.focusX, d.focusY); return true }
        })

        private val gestures = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean { onTap(); return true }
            override fun onDoubleTap(e: MotionEvent): Boolean { zoomAt(if (zoomed) fit else fit * 2.5f, e.x, e.y); return true }
            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
                if (!zoomed || pinch.isInProgress) return false
                tx -= dx; ty -= dy; clamp(); invalidate(); return true
            }
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (zoomed || e1 == null || e2.pointerCount > 1) return false
                val dx = e2.x - e1.x
                if (abs(dx) > 48 * resources.displayMetrics.density && abs(dx) > abs(e2.y - e1.y)) { onSwipe(if (dx < 0) 1 else -1); return true }
                return false
            }
        })

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            pinch.onTouchEvent(e)
            gestures.onTouchEvent(e)
            return true
        }

        override fun onDraw(c: Canvas) {
            val b = bmp ?: return
            m.reset(); m.postScale(scale, scale); m.postTranslate(tx, ty)
            c.drawBitmap(b, m, paint)
        }
    }
}
