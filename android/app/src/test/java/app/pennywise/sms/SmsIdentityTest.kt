package app.pennywise.sms

import org.junit.Assert.*
import org.junit.Test

class SmsIdentityTest {
    @Test fun senderMatchingIsExactAndAsciiNormalized() {
        assertEquals("AD-ICICIB", SmsIdentity.normalizeSender(" \tad-icicib\n"))
        assertNotEquals(SmsIdentity.normalizeSender("AD-ICICIB"), SmsIdentity.normalizeSender("VM-ICICIB"))
        assertFalse(SmsIdentity.validSender("AD|ICICI"))
        assertFalse(SmsIdentity.validSender(""))
    }
    @Test fun fingerprintMatchesBackendGoldenVector() {
        assertEquals("627607c41b7a8a8935e6161c10dbdac6d489c12f849635cbc14c68905f0b338c",
            SmsIdentity.fingerprint("AD-ICICIB", 1760000000123, "INR 100 debited | café"))
    }
    @Test fun identicalBodiesAtDifferentTimesAreDifferentEvents() {
        assertNotEquals(SmsIdentity.fingerprint("AD-ICICIB", 1000, "paid"),
            SmsIdentity.fingerprint("AD-ICICIB", 1001, "paid"))
    }
}
