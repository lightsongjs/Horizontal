package ro.horizontal.app.core

import org.json.JSONObject

data class Tokens(val access: String, val refresh: String, val expiresAt: Long, val userId: String)

/** Răspunsul GoTrue de la /auth/v1/token. Fără refresh token nu e o sesiune pe care s-o putem ține. */
fun parseTokens(json: String): Tokens? = try {
    val o = JSONObject(json)
    Tokens(o.getString("access_token"), o.getString("refresh_token"), o.getLong("expires_at") * 1000, o.getJSONObject("user").getString("id"))
} catch (e: Exception) { null }

enum class Failure { NETWORK, AUTH_DEAD, OTHER }

/** Codurile GoTrue care spun „refresh token-ul nu mai e bun", oricare ar fi statusul. */
private val DEAD_CODES = setOf("invalid_grant", "refresh_token_not_found", "invalid_credentials", "session_not_found")

/**
 * Ce înseamnă un eșec al lui /auth/v1/token. AUTH_DEAD = refresh token-ul nu
 * mai merge (rotit, revocat, parolă schimbată): sesiunea se șterge și omul e
 * rugat să se reconecteze. Se decide după CODUL GoTrue, nu după status: un
 * 400/403 venit de la un proxy sau un portal captiv (fără cod) nu spune nimic
 * despre sesiune, iar o sesiune bună aruncată acolo ar cere parola degeaba.
 * Excepția e 401: pe endpointul de refresh e chiar respingerea tokenului.
 * Orice altceva (5xx, 400/403 fără cod) se reîncearcă.
 *
 * GoTrue a schimbat forma de-a lungul versiunilor (`error`, `error_code`,
 * `code`), deci se citesc toate trei.
 */
fun classifyAuth(status: Int, body: String): Failure {
    if (status == 401) return Failure.AUTH_DEAD
    val o = try { JSONObject(body) } catch (e: Exception) { null }
    val codes = listOf("error", "error_code", "code").mapNotNull { k -> o?.opt(k)?.toString() }
    return if (codes.any { it in DEAD_CODES }) Failure.AUTH_DEAD else Failure.OTHER
}
