package app.pennywise.sms

import android.content.Context
import androidx.room.*

@Entity(tableName = "sms_queue", primaryKeys = ["account", "fingerprint"])
data class SmsQueueEntry(
    val account: String,
    val fingerprint: String,
    val sender: String?,
    val receivedAt: Long,
    val body: String?,
    val allowlistVersion: Long,
    val acknowledged: Boolean = false,
    val expired: Boolean = false,
    val attempts: Int = 0,
    val backendId: String? = null,
    val queuedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "sms_scan_state")
data class SmsScanState(@PrimaryKey val account: String, val scanEnd: Long)

@Dao
interface SmsDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insert(entries: List<SmsQueueEntry>)

    @Upsert fun checkpoint(state: SmsScanState)

    @Query("SELECT * FROM sms_scan_state WHERE account = :account")
    fun checkpoint(account: String): SmsScanState?

    @Query("SELECT * FROM sms_queue WHERE account = :account AND acknowledged = 0 AND expired = 0 ORDER BY receivedAt, fingerprint LIMIT 50")
    fun pending(account: String): List<SmsQueueEntry>

    @Query("SELECT COUNT(*) FROM sms_queue WHERE account = :account AND acknowledged = 0 AND expired = 0")
    fun pendingCount(account: String): Int

    @Query("SELECT COUNT(*) FROM sms_queue WHERE account = :account AND expired = 1")
    fun expiredCount(account: String): Int

    @Query("UPDATE sms_queue SET acknowledged = 1, body = NULL, sender = NULL, receivedAt = 0, backendId = :id WHERE account = :account AND fingerprint = :fingerprint")
    fun acknowledge(account: String, fingerprint: String, id: String?)

    @Query("UPDATE sms_queue SET attempts = attempts + 1 WHERE account = :account AND fingerprint = :fingerprint")
    fun attempted(account: String, fingerprint: String)

    @Query("DELETE FROM sms_queue WHERE acknowledged = 0")
    fun purgeUnsent()

    @Query("UPDATE sms_queue SET expired = 1, body = NULL, sender = NULL, receivedAt = 0 WHERE acknowledged = 0 AND expired = 0 AND queuedAt < :cutoff")
    fun expireUnsent(cutoff: Long): Int

    @Query("DELETE FROM sms_scan_state")
    fun clearCheckpoints()

    @Query("DELETE FROM sms_queue")
    fun clearQueue()
}

@Database(entities = [SmsQueueEntry::class, SmsScanState::class], version = 1, exportSchema = false)
abstract class SmsDatabase : RoomDatabase() {
    abstract fun queue(): SmsDao

    companion object {
        @Volatile private var instance: SmsDatabase? = null
        fun get(context: Context): SmsDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, SmsDatabase::class.java, "sms-import.db")
                .build().also { instance = it }
        }
    }
}
