package app.pennywise

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Wraps the existing web app. Refresh cookie lives in WebView's persistent cookie store. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private val appHost = Uri.parse(BuildConfig.APP_URL).host

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        // Must always answer, even on cancel, or the <input type="file"> stops responding.
        pendingFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        pendingFiles = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) // chrome://inspect
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // access token is in sessionStorage
            webViewClient = object : WebViewClient() {
                // Only our own site loads in-app, so other sites never get the JS bridge.
                // Everything else (other sites, mailto:, tel:) goes to the matching app.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    // Embedded frames (e.g. third-party widgets) must load in place, not open a browser.
                    if (!request.isForMainFrame || request.url.host == appHost) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    pendingFiles?.onReceiveValue(null)
                    pendingFiles = callback
                    // Not params.createIntent(): the page's accept=".csv" isn't a MIME type and
                    // Android often labels CSVs oddly, so any file is offered; the page validates it.
                    pickFile.launch(
                        Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),
                    )
                    return true
                }
            }
            // Picked up by downloadBlob() in frontend/src/lib/export.ts.
            addJavascriptInterface(DownloadBridge(), "PennywiseAndroid")
        }
        // Inset a native container, not the WebView: the website's viewport (including
        // fixed/sticky elements) must be physically outside system bars and the keyboard.
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            addView(web, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ))
        }
        ViewCompat.setOnApplyWindowInsetsListener(container) { v, insets ->
            val safeArea = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(container)
        ViewCompat.requestApplyInsets(container)

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) web.goBack() else finish()
        }

        if (savedInstanceState == null) web.loadUrl(BuildConfig.APP_URL) else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private inner class DownloadBridge {
        /** Saves into the public Downloads folder. Called on a WebView background thread. */
        @JavascriptInterface
        fun saveFile(base64: String, filename: String, mimeType: String) {
            val saved = runCatching {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, filename)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
                contentResolver.openOutputStream(uri)!!.use { it.write(Base64.decode(base64, Base64.DEFAULT)) }
            }.isSuccess
            runOnUiThread {
                val msg = if (saved) "Saved $filename to Downloads" else "Couldn't save $filename"
                Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
            }
        }
    }
}
