package app.pennywise.sms

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.work.WorkManager
import java.util.concurrent.Executors

/** Native-only controls. No JavaScript interface and no browser cookie access. */
class SmsSettingsActivity : ComponentActivity() {
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var prefs: SmsPreferences
    private lateinit var status: TextView
    private lateinit var token: EditText
    private lateinit var enabled: Switch
    private lateinit var connect: Button
    private lateinit var scan: Button
    private var rendering = false
    private var connecting = false
    private var scanning = false
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) enableImport() else {
            prefs.status("SMS permission denied. Import remains off. You can grant permission in Android app settings.")
            render()
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        prefs = SmsPreferences(this)
        SmsWork.reconcileDisabled(this)
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(24))
        }
        fun text(value: String, size: Float = 16f) = TextView(this).apply {
            text = value; textSize = size; setPadding(0, dp(8), 0, dp(8)); content.addView(this)
        }
        Button(this).apply { text = "Back to Pennywise"; setOnClickListener { finish() }; content.addView(this) }
        text("Android SMS import", 24f)
        text("Manual SMS scan. AI processing follows backend configuration. Review results on SMS Drafts in the app menu. Only your approval saves a Transaction to the ledger. No daily or app-open scanning is enabled in this version.")
        text("Only messages from the shared sender list are uploaded. Matching senders may also send OTPs, promotions or other personal content. When backend AI processing is enabled, these messages reach the strict verification service; only complete transactions with an explicit date reach extraction. Nothing becomes a transaction without your approval.")
        text("Create a device token in web Settings, then paste it here. The token is encrypted on this device and can be revoked from web Settings.")
        val tokenLabel = text("Device token")
        token = EditText(this).apply {
            id = View.generateViewId()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            setSingleLine(true); hint = "Paste SMS device token"; content.addView(this)
        }
        tokenLabel.labelFor = token.id
        connect = Button(this).apply {
            text = "Connect token"
            setOnClickListener { connectToken() }
            content.addView(this)
        }
        enabled = Switch(this).apply {
            text = "SMS AI import"
            setPadding(0, dp(12), 0, dp(12))
            setOnCheckedChangeListener { _, checked ->
                if (!rendering) {
                    if (!checked) {
                        SmsWork.disable(this@SmsSettingsActivity)
                        render()
                    } else showConsent()
                }
            }
            content.addView(this)
        }
        text("First activation scans from the start of today. After disabling and re-enabling, scans start at re-enablement, not during the disabled period. Disabling stops local reads/uploads and clears pending payloads; backend cancellation may wait for connectivity. Requests already sent cannot be recalled. Raw queued payloads expire after seven days; local cleanup runs with scan work.")
        scan = Button(this).apply {
            text = "Scan now"
            setOnClickListener { SmsWork.scan(this@SmsSettingsActivity); status.text = "Manual scan queued…" }
            content.addView(this)
        }
        status = text(prefs.status(), 14f)
        Button(this).apply { text = "Refresh status"; setOnClickListener { render() }; content.addView(this) }
        val scroll = ScrollView(this).apply { addView(content) }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(scroll)
        ViewCompat.requestApplyInsets(scroll)
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("sms-scan").observe(this) { work ->
            scanning = work.any { !it.state.isFinished }
            render()
        }
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("sms-control").observe(this) { render() }
        render()
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    private fun showConsent() {
        render() // Switch remains off until explicit confirmation and permission.
        android.app.AlertDialog.Builder(this).setTitle("Allow SMS upload?")
            .setMessage("Messages from configured senders, including possible OTPs and promotions, will be uploaded to your backend and sent to AI when enabled by the server operator. Only verified complete messages reach extraction. First activation includes today's messages. You can turn this off at any time.")
            .setNegativeButton("Cancel") { _, _ -> render() }
            .setPositiveButton("Allow") { _, _ ->
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED) enableImport()
                else permission.launch(Manifest.permission.READ_SMS)
            }.show()
    }
    private fun enableImport() {
        runCatching { prefs.enable() }.onFailure { prefs.status("Connect a token and finish any pending cancellation first.") }
        render()
    }
    private fun connectToken() {
        val raw = token.text.toString().trim()
        if (!raw.matches(Regex("sms_[0-9a-f]{64}"))) { token.error = "Paste a valid SMS device token"; return }
        val state = prefs.snapshot()
        if (state.enabled || state.pendingDisable) { status.text = "Disable import and wait for cancellation before replacing the token."; return }
        connecting = true
        render()
        status.text = "Connecting securely…"
        io.execute {
            val message = try {
                val api = SmsApi(raw)
                val session = api.consent(false)
                val configuration = api.request("senders").also { SmsSenderConfig.parse(it) }
                synchronized(SmsPreferences.lock) {
                    check(prefs.current(state))
                    val db = SmsDatabase.get(this)
                    db.runInTransaction { db.queue().clearQueue(); db.queue().clearCheckpoints() }
                    prefs.bind(raw, session.getString("user_id"), session.getString("id"))
                    prefs.saveConfig(configuration.toString())
                }
                "Connected. Import is off. Enable it, then tap Scan now."
            } catch (_: Exception) { "Could not connect. Check the token, backend URL and network connection." }
            prefs.status(message)
            runOnUiThread { connecting = false; if (!isDestroyed) { token.text.clear(); render() } }
        }
    }
    private fun render() {
        if (!::status.isInitialized) return
        val state = runCatching { prefs.snapshot() }.getOrElse {
            status.text = "Secure token unavailable. Clear Android app data and reconnect a device token."
            scan.isEnabled = false; enabled.isEnabled = false; return
        }
        rendering = true
        enabled.isChecked = state.enabled
        enabled.isEnabled = !connecting && state.token.isNotEmpty() && !state.pendingDisable
        scan.isEnabled = !connecting && !scanning && state.enabled && !state.pendingDisable
        connect.isEnabled = !connecting && !state.enabled && !state.pendingDisable
        status.text = if (state.pendingDisable) "Disabled locally. Waiting for backend cancellation; reconnect to the network." else prefs.status()
        rendering = false
    }
}
