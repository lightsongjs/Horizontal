package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthParseTest {
    @Test fun raspunsulGoTrue() {
        val t = parseTokens("""{"access_token":"a","refresh_token":"r","expires_at":1790000000,"user":{"id":"u1"}}""")!!
        assertEquals(Tokens("a", "r", 1_790_000_000_000L, "u1"), t)
    }
    @Test fun faraRefreshTokenNuESesiune() { assertNull(parseTokens("""{"access_token":"a"}""")) }
    // Refresh token rotit de altcineva / revocat: sesiunea e moartă, nu „offline".
    @Test fun invalidGrantEMoarta() { assertEquals(Failure.AUTH_DEAD, classifyAuth(400, """{"error":"invalid_grant","error_description":"Invalid Refresh Token"}""")) }
    @Test fun refreshTokenNotFoundEMoarta() { assertEquals(Failure.AUTH_DEAD, classifyAuth(400, """{"code":"refresh_token_not_found"}""")) }
    @Test fun parolaGresitaEMoarta() { assertEquals(Failure.AUTH_DEAD, classifyAuth(400, """{"error_code":"invalid_credentials"}""")) }
    @Test fun cinciSuteNuOmoaraSesiunea() { assertEquals(Failure.OTHER, classifyAuth(503, "")) }
}
