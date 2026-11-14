package dev.jcode.stillness

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import dev.jcode.stillness.native.DeepLinks
import dev.jcode.stillness.native.LayoutState
import dev.jcode.stillness.native.ShareInbox
import java.util.concurrent.Executors

/**
 * Android host activity.
 *
 * Responsibilities that belong to the activity and nowhere else:
 * - edge-to-edge insets applied to the webview container,
 * - predictive back that offers the webview a chance to consume the gesture,
 * - inbound share and deep-link capture before the webview is ready.
 *
 * The WebView is never recreated for configuration changes: the manifest
 * declares the handled configuration changes, and the activity keeps the same
 * webview instance for its whole lifetime.
 */
class MainActivity : TauriActivity() {
  private var contentWebView: WebView? = null
  private val intentRouter = Executors.newSingleThreadExecutor()
  private var backInFlight = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    installBackHandling()
    routeIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    contentWebView = webView
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      LayoutState.apply(view, insets)
      insets
    }
    webView.requestApplyInsets()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    routeIntent(intent)
  }

  override fun onDestroy() {
    intentRouter.shutdown()
    super.onDestroy()
  }

  /**
   * Queue inbound shares and deep links off the main thread. Copying an inbound
   * image must not block the first frame. The queue is durable, so a slow copy
   * is picked up by the next `consume` call even if the client started earlier.
   */
  private fun routeIntent(intent: Intent?) {
    if (intent == null) return
    val copy = Intent(intent)
    intentRouter.execute {
      try {
        if (!ShareInbox.capture(this, copy)) {
          DeepLinks.capture(this, copy)
        }
      } catch (error: Exception) {
        android.util.Log.w("JCodeMainActivity", "could not route the launch intent", error)
      }
    }
  }

  private fun installBackHandling() {
    // Always use the AndroidX dispatcher. ComponentActivity installs its own
    // OnBackInvokedCallback on API 33+, so a second direct registration would be
    // preempted and the activity would finish without consulting the webview.
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          dispatchBack()
        }
      },
    )
  }

  /**
   * Ask the webview whether it consumed the back gesture. No answer inside
   * [BACK_TIMEOUT_MS] means the page is not in a position to handle back, so the
   * activity finishes rather than swallowing the gesture.
   */
  private fun dispatchBack() {
    val view = contentWebView
    android.util.Log.i("JCodeBack", "back dispatched, webview=${view != null}")
    if (view == null) {
      finish()
      return
    }
    if (backInFlight) return
    backInFlight = true
    var resolved = false
    val timeout = Runnable {
      if (!resolved) {
        android.util.Log.w("JCodeBack", "webview did not answer; finishing")
        resolved = true
        backInFlight = false
        finish()
      }
    }
    view.postDelayed(timeout, BACK_TIMEOUT_MS)
    view.evaluateJavascript(BACK_SCRIPT) { value ->
      view.removeCallbacks(timeout)
      android.util.Log.i("JCodeBack", "webview answered $value")
      if (resolved) return@evaluateJavascript
      resolved = true
      backInFlight = false
      if (value != "true" && value != "\"true\"") {
        finish()
      }
    }
  }

  private companion object {
    const val BACK_TIMEOUT_MS = 800L
    const val BACK_SCRIPT =
      "(function(){try{if(typeof window.__jcodeBackHandler==='function')" +
        "{return window.__jcodeBackHandler()===true;}return false;}catch(e){return false;}})()"
  }
}
