package ro.horizontal.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import org.json.JSONObject
import ro.horizontal.app.core.NativeFile
import ro.horizontal.app.core.ShotCandidate
import java.io.File
import java.util.UUID

/**
 * Atașamentele ferestrei de quick add. Octeții se copiază ÎN CLIPA alegerii, în
 * `cacheDir/capture/` (permisiunea pe un URI ales moare odată cu fereastra), și
 * se micșorează după regula paginii (`shrinkPlan` din motor; fără motor pleacă
 * originalul). Urcarea o face `DrainWorker`, după ce sarcina există.
 *
 * Fișierele nu trec prin coada offline (ca în pagină): fără rețea la Trimite,
 * fereastra le refuză pe față (`canSend`).
 */
object NativeFiles {
    data class Picked(val path: String, val filename: String, val contentType: String, val size: Long)

    fun dir(ctx: Context) = File(ctx.cacheDir, "capture").apply { mkdirs() }

    /** Fișierul în care camera scrie poza (prin FileProvider; `cache-path` din `file_paths.xml`). */
    fun cameraTarget(ctx: Context): File = File(dir(ctx), "poza-${UUID.randomUUID()}.jpg")

    fun online(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** Copiază ce a ales omul (fișier sau poză), pe un fir de lucru. `null` = nu s-a putut citi. */
    fun copyIn(ctx: Context, uri: Uri): Picked? = try {
        val cr = ctx.contentResolver
        val name = cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "fisier"
        val type = cr.getType(uri) ?: "application/octet-stream"
        val out = File(dir(ctx), "${UUID.randomUUID()}-${name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(60)}")
        cr.openInputStream(uri)!!.use { i -> out.outputStream().use { o -> i.copyTo(o) } }
        Picked(out.path, name, type, out.length())
    } catch (e: Exception) { null }

    /**
     * Micșorarea, după planul paginii (`shrinkPlan`: dimensiuni, format). Orice
     * îndoială → originalul, ca în pagină; la fel dacă rezultatul iese mai mare.
     * `plan` și `filename` vin din motor; fără motor (`null`) pleacă originalul.
     */
    fun shrink(p: Picked, plan: JSONObject?, filename: String?): Picked {
        if (plan == null || plan.optString("action") == "skip" || plan.isNull("outputType")) return p.copy(filename = filename ?: p.filename)
        return try {
            val w = plan.getInt("width"); val h = plan.getInt("height")
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(p.path, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= w && bounds.outHeight / (sample * 2) >= h) sample *= 2
            val raw = BitmapFactory.decodeFile(p.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return p
            val scaled = Bitmap.createScaledBitmap(raw, w, h, true)
            val rotated = rotateByExif(p.path, scaled)
            val webp = plan.getString("outputType") == "image/webp"
            val out = File(p.path + if (webp) ".webp" else ".jpg")
            out.outputStream().use { o ->
                val fmt = if (!webp) Bitmap.CompressFormat.JPEG
                    else if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY
                    else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
                rotated.compress(fmt, 92, o)
            }
            if (out.length() >= p.size) { out.delete(); return p.copy(filename = filename ?: p.filename) }
            File(p.path).delete()
            Picked(out.path, filename ?: p.filename, plan.getString("outputType"), out.length())
        } catch (e: Throwable) { p }
    }

    /** Poza camerei e de obicei „culcată" + o etichetă EXIF; reencodată, eticheta s-ar pierde. */
    private fun rotateByExif(path: String, b: Bitmap): Bitmap {
        val deg = when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return b
        }
        return Bitmap.createBitmap(b, 0, 0, b.width, b.height, Matrix().apply { postRotate(deg) }, true)
    }

    /** Permisiunea de citire a pozelor, după versiune (Android 13 a spart-o pe tipuri). */
    val photosPermission: String get() =
        if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_IMAGES else android.Manifest.permission.READ_EXTERNAL_STORAGE

    fun photosGranted(ctx: Context) =
        androidx.core.content.ContextCompat.checkSelfPermission(ctx, photosPermission) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** Pozele adăugate din `since` încoace (cele mai noi întâi), pentru `screenshotOffer`. Fără drept → nimic. */
    fun recentImages(ctx: Context, since: Long): List<ShotCandidate> = try {
        val cols = buildList {
            add(MediaStore.Images.Media._ID); add(MediaStore.Images.Media.DATE_ADDED); add(MediaStore.Images.Media.MIME_TYPE)
            @Suppress("DEPRECATION") add(MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME)
            if (Build.VERSION.SDK_INT >= 29) add(MediaStore.Images.Media.RELATIVE_PATH)
        }
        ctx.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols.toTypedArray(),
            "${MediaStore.Images.Media.DATE_ADDED} >= ?", arrayOf((since / 1000).toString()),
            "${MediaStore.Images.Media.DATE_ADDED} DESC",
        )?.use { c ->
            val out = mutableListOf<ShotCandidate>()
            while (out.size < 20 && c.moveToNext()) {
                out += ShotCandidate(
                    id = c.getLong(0), addedAt = c.getLong(1) * 1000, mime = c.getString(2), bucket = c.getString(3),
                    relativePath = if (cols.size > 4) c.getString(4) else null,
                )
            }
            out
        } ?: emptyList()
    } catch (e: Exception) { emptyList() }

    fun imageUri(id: Long): Uri = android.content.ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

    /** Miniatura ofertei; `null` = n-a putut fi citită (atunci nici nu se oferă). */
    fun thumbnail(ctx: Context, uri: Uri, px: Int): Bitmap? = try {
        if (Build.VERSION.SDK_INT >= 29) ctx.contentResolver.loadThumbnail(uri, android.util.Size(px, px), null)
        else ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = 8 }) }
    } catch (e: Exception) { null }

    fun dimensions(path: String): Pair<Int, Int> {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, o)
        return o.outWidth to o.outHeight
    }

    fun toNative(p: Picked) = NativeFile(p.path, p.filename, p.contentType, p.size, UUID.randomUUID().toString())
}
