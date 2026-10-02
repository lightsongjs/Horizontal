package ro.horizontal.app.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountTest {
    @Test fun primulLoginNuEschimbare() { assertFalse(accountSwitched(null, "u1")) }
    // Sesiune moartă și reconectare cu ACELAȘI cont: coada rămasă trebuie să plece, nu să fie ștearsă.
    @Test fun acelasiContPastreaza() { assertFalse(accountSwitched("u1", "u1")) }
    @Test fun altContGoleste() { assertTrue(accountSwitched("u1", "u2")) }
}
