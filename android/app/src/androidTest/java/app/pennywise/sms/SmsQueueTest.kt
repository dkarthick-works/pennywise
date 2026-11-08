package app.pennywise.sms

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SmsQueueTest {
    @Test fun expirationIsNotAnUploadAcknowledgement() {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), SmsDatabase::class.java).build()
        try {
            val dao = db.queue()
            val entry = SmsQueueEntry("account", "expired-hash", "AD-ICICIB", 1000, "paid", 1, queuedAt = 1000)
            dao.insert(listOf(entry))
            assertEquals(1, dao.expireUnsent(2000))
            assertEquals(0, dao.pendingCount("account"))
            assertEquals(1, dao.expiredCount("account"))
            dao.insert(listOf(entry))
            assertEquals(0, dao.pendingCount("account"))
            assertEquals(1, dao.expiredCount("account"))
            dao.purgeUnsent()
            assertEquals(0, dao.expiredCount("account"))
        } finally { db.close() }
    }

    @Test fun checkpointAndQueueCommitOrRollbackTogether() {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), SmsDatabase::class.java).build()
        try {
            val dao = db.queue()
            val entry = SmsQueueEntry("account", "hash", "AD-ICICIB", 1000, "paid", 1)
            try {
                db.runInTransaction {
                    dao.insert(listOf(entry))
                    dao.checkpoint(SmsScanState("account", 2000))
                    error("simulated interruption")
                }
            } catch (_: IllegalStateException) { }
            assertEquals(0, dao.pendingCount("account"))
            assertNull(dao.checkpoint("account"))
            db.runInTransaction { dao.insert(listOf(entry)); dao.checkpoint(SmsScanState("account", 2000)) }
            dao.insert(listOf(entry))
            assertEquals(1, dao.pendingCount("account"))
            assertEquals(2000L, dao.checkpoint("account")!!.scanEnd)
            dao.acknowledge("account", "hash", "server-id")
            dao.insert(listOf(entry)) // Acknowledged fingerprints remain deduplication tombstones.
            assertEquals(0, dao.pendingCount("account"))
            assertEquals(2000L, dao.checkpoint("account")!!.scanEnd)
        } finally { db.close() }
    }
}
