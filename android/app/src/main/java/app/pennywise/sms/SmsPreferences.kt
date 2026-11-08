package app.pennywise.sms

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Payloads live in private, backup-excluded SQLite. The device token is Keystore encrypted. */
class SmsPreferences(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("sms-import", Context.MODE_PRIVATE)
    data class Snapshot(
        val generation: Long, val enabled: Boolean, val pendingDisable: Boolean,
        val account: String, val token: String, val firstScanStart: Long,
    )

    fun snapshot(): Snapshot = synchronized(lock) {
        val encrypted = prefs.getString("token", null)
        Snapshot(prefs.getLong("generation", 0), prefs.getBoolean("enabled", false),
            prefs.getBoolean("pending_disable", false), prefs.getString("account", "")!!,
            encrypted?.let { decrypt(it) } ?: "", prefs.getLong("first_start", 0))
    }

    fun bind(token: String, account: String, device: String) = synchronized(lock) {
        val old = snapshot()
        check(!old.enabled && !old.pendingDisable) { "Disable and sync the old device before replacing its token." }
        check(prefs.edit().putString("token", encrypt(token)).putString("account", account)
            .putString("device", device).putBoolean("enabled", false)
            .putLong("generation", old.generation + 1).putBoolean("ever_enabled", false)
            .putLong("first_start", 0).remove("config").commit())
    }

    fun enable() = synchronized(lock) {
        val old = snapshot()
        check(old.token.isNotEmpty() && !old.pendingDisable)
        val first = !prefs.getBoolean("ever_enabled", false)
        val start = if (first) java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis else System.currentTimeMillis()
        check(prefs.edit().putBoolean("enabled", true).putBoolean("ever_enabled", true)
            .putLong("first_start", start).putLong("generation", old.generation + 1).commit())
    }

    // Called before cancelling work. The generation fences a scanner's later SQLite commit.
    fun disable() = synchronized(lock) {
        check(prefs.edit().putBoolean("enabled", false).putBoolean("pending_disable", true)
            .putLong("generation", prefs.getLong("generation", 0) + 1).commit())
    }
    fun disabledSynced(snapshot: Snapshot) = synchronized(lock) {
        if (current(snapshot)) check(prefs.edit().putBoolean("pending_disable", false).commit())
    }
    fun current(snapshot: Snapshot): Boolean = synchronized(lock) {
        prefs.getLong("generation", 0) == snapshot.generation
    }
    fun saveConfig(json: String) { check(prefs.edit().putString("config", json).commit()) }
    fun config(): String? = prefs.getString("config", null)
    fun status(message: String) { prefs.edit().putString("status", message).apply() }
    fun status(): String = prefs.getString("status", "Not scanned. AI processing follows backend configuration.")!!

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("pennywise-sms-token", null) as? SecretKey) ?: KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("pennywise-sms-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
    companion object {
        // Only short settings/SQLite commits use this lock, never network calls.
        val lock = Any()
    }
}
