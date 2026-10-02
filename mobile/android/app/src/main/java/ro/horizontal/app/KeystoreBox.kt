package ro.horizontal.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cheia AES stă în Android Keystore și nu iese din el. Pe disc ajunge doar
 * textul criptat. Un refresh token furat de pe disc fără cheie nu valorează nimic.
 * Formatul cutiei: base64(iv de 12 octeți + text criptat cu tagul GCM de 128 biți).
 */
object KeystoreBox {
    private const val ALIAS = "hz-session"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    fun encrypt(plain: String): String {
        // IV-ul îl alege Keystore-ul (nu-l dăm noi): refolosirea unui IV cu GCM ar sparge criptarea.
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    /** `null` = cutie coruptă sau cheie pierdută (restaurare din backup, Keystore resetat). */
    fun decrypt(box: String): String? = try {
        val raw = Base64.decode(box, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12)) }
        String(c.doFinal(raw, 12, raw.size - 12))
    } catch (e: Exception) { null }
}
