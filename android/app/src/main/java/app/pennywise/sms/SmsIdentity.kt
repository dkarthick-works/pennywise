package app.pennywise.sms

import java.security.MessageDigest

/** Must stay byte-for-byte compatible with backend smsFingerprint, version 1. */
object SmsIdentity {
    fun normalizeSender(value: String): String = value.trim(' ', '\t', '\r', '\n').map {
        if (it in 'a'..'z') it.uppercaseChar() else it
    }.joinToString("")

    fun validSender(value: String): Boolean = value.length in 1..80 &&
        value.all { it.code in 33..126 && it != '|' }

    fun fingerprint(sender: String, receivedAt: Long, body: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest("v1|$sender|$receivedAt|$body".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
