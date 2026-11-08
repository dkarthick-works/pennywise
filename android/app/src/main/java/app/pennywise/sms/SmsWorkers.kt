package app.pennywise.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.CancellationSignal
import android.provider.Telephony
import androidx.core.content.ContextCompat
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Phase 3: only Scan now enqueues scanning. No periodic or foreground trigger yet. */
object SmsWork {
    fun scan(context: Context) {
        val work = OneTimeWorkRequestBuilder<SmsScanWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("sms-scan", ExistingWorkPolicy.KEEP, work)
    }
    fun disable(context: Context) {
        val prefs = SmsPreferences(context)
        synchronized(SmsPreferences.lock) { prefs.disable() }
        WorkManager.getInstance(context).cancelUniqueWork("sms-scan")
        reconcileDisabled(context)
    }
    fun reconcileDisabled(context: Context) {
        if (!runCatching { SmsPreferences(context).snapshot().pendingDisable }.getOrDefault(false)) return
        // Persisted work survives process death. Appending ensures a state change
        // arriving during an existing control request gets another reconciliation.
        WorkManager.getInstance(context).enqueueUniqueWork("sms-control", ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SmsControlWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
    }
}

class SmsControlWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val prefs = SmsPreferences(applicationContext)
        return try {
            val state = prefs.snapshot()
            if (!state.pendingDisable) return Result.success()
            synchronized(SmsPreferences.lock) {
                SmsDatabase.get(applicationContext).runInTransaction {
                    SmsDatabase.get(applicationContext).queue().purgeUnsent()
                    SmsDatabase.get(applicationContext).queue().clearCheckpoints()
                }
            }
            if (state.token.isNotEmpty()) SmsApi(state.token).consent(false)
            prefs.disabledSynced(state)
            prefs.status("Disabled. Pending local messages cleared; backend cancellation confirmed.")
            Result.success()
        } catch (error: SmsApi.Failure) {
            if (error.status == 401) {
                val state = prefs.snapshot()
                prefs.disabledSynced(state)
                prefs.status("Disabled. Device token is invalid or revoked; local pending messages cleared.")
                Result.success()
            } else {
                prefs.status("Disabled locally. Backend cancellation pending; check connectivity.")
                Result.retry()
            }
        } catch (_: Exception) {
            prefs.status("Disabled locally. Backend cancellation pending; check connectivity.")
            Result.retry()
        }
    }
}

class SmsScanWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    private val cancellation = CancellationSignal()
    override fun onStopped() { cancellation.cancel(); super.onStopped() }

    private fun permitted() = ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    override fun doWork(): Result {
        val prefs = SmsPreferences(applicationContext)
        val database = SmsDatabase.get(applicationContext)
        val dao = database.queue()
        return try {
            val state = prefs.snapshot()
            fun active(): Boolean = !isStopped && state.enabled && !state.pendingDisable &&
                prefs.current(state) && permitted()
            if (!active()) {
                if (state.enabled && !permitted()) SmsWork.disable(applicationContext)
                return Result.success()
            }
            val api = SmsApi(state.token)
            val config = try {
                val json = api.request("senders")
                SmsSenderConfig.parse(json).also {
                    synchronized(SmsPreferences.lock) { if (active()) prefs.saveConfig(json.toString()) }
                }
            } catch (error: Exception) {
                if (error is SmsApi.Failure && error.status == 401) throw error
                prefs.config()?.let { SmsSenderConfig.parse(JSONObject(it)) } ?: throw IOException("No sender configuration")
            }
            if (!active()) return Result.success()
            dao.expireUnsent(System.currentTimeMillis() - TimeUnit.DAYS.toMillis(7))
            // An empty authoritative list is a valid configuration and permits nothing.
            prefs.status("Scanning SMS from configured senders…")
            var scanFailed = false
            var scannedRows = 0
            var matchedMessages = 0
            try {
            val now = System.currentTimeMillis()
            val checkpoint = dao.checkpoint(state.account)?.scanEnd ?: state.firstScanStart
            run {
                // One bounded day per invocation; another Scan now continues catch-up.
                // On clock rollback, rescan today's range without moving the saved
                // high-water mark backwards. Never wait for a future checkpoint.
                val rollbackStart = java.util.Calendar.getInstance().apply {
                    set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
                    set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
                }.timeInMillis
                val end = if (now < checkpoint) now else minOf(now, checkpoint + TimeUnit.DAYS.toMillis(1))
                val start = if (now < checkpoint) rollbackStart else maxOf(state.firstScanStart, checkpoint - TimeUnit.HOURS.toMillis(6))
                val messages = mutableListOf<SmsQueueEntry>()
                var queuedBytes = 0
                applicationContext.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI,
                    arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.BODY),
                    "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} < ?",
                    arrayOf(start.toString(), end.toString()), "${Telephony.Sms.DATE} ASC, ${Telephony.Sms._ID} ASC", cancellation
                )?.use { cursor ->
                    var rows = 0
                    while (cursor.moveToNext()) {
                        if (!active()) return Result.success()
                        if (++rows > 5000) throw IOException("Scan range too large")
                        val sender = SmsIdentity.normalizeSender(cursor.getString(1) ?: "")
                        if (sender !in config.senders) continue // Never access/copy a nonmatching body.
                        val date = cursor.getLong(2)
                        val body = cursor.getString(3) ?: ""
                        // Match server byte limits. Never advance past unqueueable matching content silently.
                        val bodyBytes = body.toByteArray(Charsets.UTF_8).size
                        if (body.isEmpty() || bodyBytes > 16384 || '\u0000' in body) throw IOException("Unsupported SMS size")
                        queuedBytes += bodyBytes
                        if (queuedBytes > 8 * 1024 * 1024) throw IOException("Scan payload limit reached")
                        messages.add(SmsQueueEntry(state.account, SmsIdentity.fingerprint(sender, date, body), sender, date, body, config.version))
                    }
                    scannedRows = rows
                } ?: throw IOException("SMS provider unavailable")
                matchedMessages = messages.size
                synchronized(SmsPreferences.lock) {
                    if (!active()) return Result.success()
                    database.runInTransaction {
                        if (dao.pendingCount(state.account) + messages.size > 10000) throw IOException("Local queue full")
                        dao.insert(messages)
                        dao.checkpoint(SmsScanState(state.account, maxOf(checkpoint, end)))
                    }
                }
            }
            } catch (error: SecurityException) { throw error }
              catch (_: Exception) { scanFailed = true }
            if (!active()) return Result.success()
            // Scanning can queue offline using cached configuration. A failed new
            // scan must not block delivery of older, durably queued messages.
            val session = api.consent(true, ::active)
            if (!active()) return Result.success()
            check(session.getString("user_id") == state.account)
            val consentVersion = session.getLong("consent_version")
            uploadPending(api, state, prefs, config, consentVersion, ::active)
            if (scanFailed) {
                prefs.status("Scan incomplete; checkpoint unchanged. Existing queued messages uploaded where possible. Retry Scan now.")
                return if (runAttemptCount < 5) Result.retry() else Result.failure()
            }
            if (!active()) return Result.success()
            val remaining = dao.pendingCount(state.account)
            if (remaining == 0) {
                val expired = dao.expiredCount(state.account)
                val end = if (expired == 0) dao.checkpoint(state.account)?.scanEnd?.coerceAtMost(System.currentTimeMillis()) else null
                api.request("uploads", "POST", JSONObject().put("consent_version", consentVersion)
                    .put("allowlist_version", config.version).put("messages", JSONArray()).put("scan_end", end))
                prefs.status(when {
                    expired > 0 -> "Some queued messages expired without upload. New messages were synced, but coverage is incomplete. Disable/re-enable to start a new capture boundary."
                    config.senders.isEmpty() -> "No senders configured. No SMS uploaded; ask the maintainer to populate the global sender list."
                    scannedRows == 0 -> "No received SMS in the scanned range. Sync coverage recorded."
                    matchedMessages == 0 -> "No SMS matched the global sender list in this range. Sync coverage recorded."
                    else -> "Scanned range synced. Uploaded messages are processed when backend SMS AI is enabled; nothing is saved to the ledger automatically."
                })
                Result.success()
            } else {
                prefs.status("Some messages are queued locally. Upload will retry.")
                Result.retry()
            }
        } catch (error: SmsApi.Failure) {
            if (error.status == 401 || error.status == 409) {
                SmsWork.disable(applicationContext)
                prefs.status("SMS import stopped. Check the device token and consent in native settings.")
                Result.failure()
            } else {
                prefs.status("Upload not confirmed. Messages remain queued; retrying.")
                if (runAttemptCount < 5) Result.retry() else Result.failure()
            }
        } catch (_: SecurityException) {
            SmsWork.disable(applicationContext)
            prefs.status("SMS permission unavailable. Import disabled.")
            Result.failure()
        } catch (_: Exception) {
            if (!isStopped) prefs.status("Scan or upload interrupted. Saved messages remain queued. Retry Scan now.")
            if (runAttemptCount < 5 && !isStopped) Result.retry() else Result.failure()
        }
    }

    private fun uploadPending(api: SmsApi, state: SmsPreferences.Snapshot, prefs: SmsPreferences,
        config: SmsSenderConfig, consentVersion: Long, active: () -> Boolean) {
        val dao = SmsDatabase.get(applicationContext).queue()
        repeat(10) { // Bounded execution; WorkManager retries any remaining backlog.
            if (!active()) return
            val batch = dao.pending(state.account)
            if (batch.isEmpty()) return
            // JSON escaping can expand a control byte sixfold. Keep even hostile
            // long-message batches comfortably below the backend's 2 MiB limit.
            var encodedBudget = 0
            val eligible = batch.filter { it.sender in config.senders }.takeWhile {
                encodedBudget += (it.body?.toByteArray(Charsets.UTF_8)?.size ?: 0) * 6 + 512
                encodedBudget <= 1_500_000
            }
            // Removed senders are terminal locally; no body is uploaded.
            batch.filter { it.sender !in config.senders }.forEach { dao.acknowledge(state.account, it.fingerprint, null) }
            if (eligible.isEmpty()) return@repeat
            val messages = JSONArray()
            eligible.forEach {
                messages.put(JSONObject().put("fingerprint_version", 1).put("fingerprint", it.fingerprint)
                    .put("sender", it.sender).put("received_at", it.receivedAt).put("body", it.body))
                dao.attempted(state.account, it.fingerprint)
            }
            if (!active()) return
            prefs.status("Uploading queued SMS…")
            val result = api.request("uploads", "POST", JSONObject().put("consent_version", consentVersion)
                .put("allowlist_version", config.version).put("messages", messages))
            val receipts = result.getJSONArray("receipts")
            val expected = eligible.map { it.fingerprint }.toSet()
            val received = (0 until receipts.length()).map { receipts.getJSONObject(it).getString("fingerprint") }
            if (received.size != expected.size || received.toSet() != expected) throw IOException("Incomplete acknowledgement")
            SmsDatabase.get(applicationContext).runInTransaction {
                for (i in 0 until receipts.length()) {
                    val receipt = receipts.getJSONObject(i)
                    val id = if (receipt.isNull("id")) null else receipt.getString("id")
                    dao.acknowledge(state.account, receipt.getString("fingerprint"), id)
                }
            }
        }
    }
}
