package app.pennywise.sms

import app.pennywise.BuildConfig
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class SmsApi(private val token: String) {
    class Failure(val status: Int) : IOException("SMS request failed ($status)")

    fun request(path: String, method: String = "GET", payload: JSONObject? = null): JSONObject {
        val base = URL(BuildConfig.APP_URL)
        check(base.protocol == "https" || (BuildConfig.DEBUG && base.host in listOf("localhost", "10.0.2.2")))
        val connection = URL(base, "/api/sms/device/$path").openConnection() as HttpURLConnection
        return try {
            connection.instanceFollowRedirects = false // Never forward the credential across redirects.
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.requestMethod = method
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (code !in 200..299) throw Failure(code) // Never persist/log response bodies, which may contain data.
            connection.inputStream.bufferedReader().use { reader ->
                val text = StringBuilder()
                val buffer = CharArray(4096)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    if (text.length + count > 256000) throw IOException("SMS response too large")
                    text.append(buffer, 0, count)
                }
                JSONObject(text.toString())
            }
        } finally { connection.disconnect() }
    }

    fun consent(enabled: Boolean, permitted: () -> Boolean = { true }): JSONObject {
        if (!permitted()) throw IOException("Consent superseded")
        val session = request("session")
        if (!permitted()) throw IOException("Consent superseded")
        return request("consent", "PUT", JSONObject().put("enabled", enabled)
            .put("expected_version", session.getLong("consent_version")))
    }
}

data class SmsSenderConfig(val version: Long, val senders: Set<String>) {
    companion object {
        fun parse(json: JSONObject): SmsSenderConfig {
            val version = json.getLong("version")
            require(version > 0)
            val array = json.getJSONArray("senders")
            require(array.length() <= 5000)
            val senders = (0 until array.length()).map {
                SmsIdentity.normalizeSender(array.getString(it)).also { sender -> require(SmsIdentity.validSender(sender)) }
            }.toSet()
            return SmsSenderConfig(version, senders)
        }
    }
}
