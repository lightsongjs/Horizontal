package ro.horizontal.app.core

import org.json.JSONObject

data class Tokens(val access: String, val refresh: String, val expiresAt: Long, val userId: String)

/** Răspunsul GoTrue de la /auth/v1/token. Fără refresh token nu e o sesiune pe care s-o putem ține. */
fun parseTokens(json: String): Tokens? = try {
    val o = JSONObject(json)
    Tokens(o.getString("access_token"), o.getString("refresh_token"), o.getLong("expires_at") * 1000, o.getJSONObject("user").getString("id"))
} catch (e: Exception) { null }

enum class Failure { NETWORK, AUTH_DEAD, OTHER }

/**
 * Ce înseamnă un eșec al lui /auth/v1/token. AUTH_DEAD = refresh token-ul nu
 * mai merge (rotit, revocat, parolă schimbată): sesiunea se șterge și omul e
 * rugat să se reconecteze. Orice altceva (5xx) se reîncearcă — o sesiune bună
 * aruncată la un 503 ar cere parola degeaba.
 */
fun classifyAuth(status: Int, body: String): Failure {
    if (status == 400 || status == 401 || status == 403) return Failure.AUTH_DEAD
    return Failure.OTHER
}
