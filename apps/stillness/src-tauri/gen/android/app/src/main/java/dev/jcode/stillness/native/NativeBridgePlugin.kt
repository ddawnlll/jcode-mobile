package dev.jcode.stillness.native

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/**
 * Tauri command surface for every Android native feature.
 *
 * This is the only Kotlin entry point the Rust plugin forwards to. Each command
 * returns a typed data class whose field names match the Rust structs and the
 * TypeScript interfaces in `src/lib/native-types.ts`. Failures reject with an
 * explicit code instead of resolving a plausible-looking default.
 */
@TauriPlugin
class NativeBridgePlugin(private val host: Activity) : Plugin(host) {

    fun activityOrNull(): Activity? = host

    override fun load(webView: android.webkit.WebView) {
        NativeEvents.attach(this, host)
        Notifications.ensureChannels(host)
        LayoutState.snapshot()
    }

    override fun onNewIntent(intent: Intent) {
        // MainActivity owns intent routing so a share is queued exactly once.
    }

    override fun onDestroy(activity: AppCompatActivity) {
        NativeEvents.detach(this)
        super.onDestroy(activity)
    }

    @Command
    fun platformStatus(invoke: Invoke) = guarded(invoke) {
        val version = try {
            host.packageManager.getPackageInfo(host.packageName, 0).versionName ?: ""
        } catch (error: Exception) {
            ""
        }
        invoke.resolveObject(
            mapOf(
                "platform" to "android",
                "apiLevel" to Build.VERSION.SDK_INT,
                "deviceModel" to "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                "appVersion" to version,
                "edgeToEdge" to LayoutState.edgeToEdge,
                "predictiveBack" to LayoutState.predictiveBack,
            ),
        )
    }

    @Command
    fun capabilities(invoke: Invoke) = guarded(invoke) {
        val reasons = LinkedHashMap<String, String>()
        val status = Notifications.status(host)
        val biometric = BiometricLock.status(host)
        val vibrator = host.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
        if (!biometric.available) reasons["biometricLock"] = biometric.message
        val push = PushRegistration.status(host)
        reasons["push"] = push.reason
        val camera = Pickers.cameraAvailable(host)
        if (!camera) reasons["camera"] = "no camera activity is installed"
        val imagePicker = Pickers.available(host)
        if (!imagePicker) reasons["photoPicker"] = "no photo picker or document picker is installed"
        if (vibrator?.hasVibrator() != true) reasons["haptics"] = "this device has no vibrator"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) {
            reasons["shortcuts"] = "dynamic shortcuts require Android 7.1"
        }
        invoke.resolveObject(
            mapOf(
                "notifications" to if (status.channels.isEmpty()) "unavailable" else "available",
                "push" to "not_configured",
                "backgroundSync" to "available",
                "shareIn" to "available",
                "shareOut" to "available",
                "biometricLock" to if (biometric.available) "available" else "unavailable",
                "photoPicker" to if (imagePicker) "available" else "unavailable",
                "documentPicker" to "available",
                "camera" to if (camera) "available" else "unavailable",
                "qrCamera" to if (camera) "available" else "blocked",
                "qrImage" to "available",
                "downloads" to "available",
                "openWith" to "available",
                "clipboard" to "available",
                "haptics" to if (vibrator?.hasVibrator() == true) "available" else "unavailable",
                "shortcuts" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                    "available"
                } else {
                    "unavailable"
                },
                "widget" to "available",
                "quickSettingsTile" to "available",
                "reasons" to reasons,
            ),
        )
    }

    @Command
    fun settingsGet(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val keys = args.optJSONArray("keys")?.let { array ->
            (0 until array.length()).mapNotNull { array.optString(it, null) }
        }
        val values = NativeSettings.snapshot(host, keys)
        invoke.resolveObject(mapOf("values" to values))
    }

    @Command
    fun settingsSet(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val raw = args.optJSONObject("values")
            ?: return@guarded invoke.reject("values object is required", "invalid_setting")
        val values = LinkedHashMap<String, Any?>()
        for (key in raw.keys()) {
            values[key] = raw.get(key)
        }
        try {
            require(
                NativeSettings.KEY_BACKGROUND_SYNC_ENABLED !in values &&
                    NativeSettings.KEY_BACKGROUND_SYNC_INTERVAL !in values,
            ) { "use backgroundSyncSet to change background sync settings" }
            val stored = NativeSettings.set(host, values)
            invoke.resolveObject(mapOf("values" to stored))
        } catch (error: IllegalArgumentException) {
            invoke.reject(error.message ?: "invalid setting", "invalid_setting")
        }
    }

    @Command
    fun notificationStatus(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(Notifications.status(host))
    }

    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            invoke.resolveObject(Notifications.status(host))
            return
        }
        if (host.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            invoke.resolveObject(Notifications.status(host))
            return
        }
        Notifications.markPermissionAsked(host)
        handle!!.requestPermissions(
            invoke,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            "onNotificationPermissionResult",
        )
    }

    @PermissionCallback
    fun onNotificationPermissionResult(invoke: Invoke) {
        invoke.resolveObject(Notifications.status(host))
    }

    @Command
    fun postNotification(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val request = Notifications.PostRequest(
            kind = args.getString("kind", null),
            title = args.getString("title", null),
            body = args.getString("body", null),
            sessionId = args.getString("sessionId", null),
            turnId = args.getString("turnId", null),
        )
        invoke.resolveObject(Notifications.post(host, request))
    }

    @Command
    fun pushStatus(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(PushRegistration.status(host))
    }

    @Command
    fun pushRegisterLocal(invoke: Invoke) = guarded(invoke) {
        val token = invoke.getArgs().getString("token", null)
            ?: return@guarded invoke.reject("token is required", "invalid_token")
        try {
            invoke.resolveObject(PushRegistration.registerLocal(host, token))
        } catch (error: IllegalArgumentException) {
            invoke.reject(error.message ?: "invalid token", "invalid_token")
        }
    }

    @Command
    fun backgroundSyncStatus(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(BackgroundSync.status(host))
    }

    @Command
    fun backgroundSyncSet(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val enabled = args.getBoolean("enabled", false)
        val interval = args.optInt("intervalMinutes", 0).takeIf { it > 0 }
        val baseUrl = args.getString("baseUrl", null)
        try {
            invoke.resolveObject(BackgroundSync.set(host, enabled, interval, baseUrl))
        } catch (error: IllegalArgumentException) {
            invoke.reject(error.message ?: "invalid sync configuration", "invalid_setting")
        } catch (error: Exception) {
            invoke.reject(error.message ?: "could not schedule sync", "sync_schedule_failed")
        }
    }

    @Command
    fun backgroundSyncRunNow(invoke: Invoke) = guarded(invoke) {
        try {
            invoke.resolveObject(BackgroundSync.runNow(host))
        } catch (error: IllegalArgumentException) {
            invoke.reject(error.message ?: "background sync is disabled", "sync_disabled")
        }
    }

    @Command
    fun shareConsumePending(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(ShareInbox.consume(host))
    }

    @Command
    fun shareOutbound(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val request = ShareOut.OutboundRequest(
            text = args.getString("text", null),
            url = args.getString("url", null),
            uri = args.getString("uri", null),
            mimeType = args.getString("mimeType", null),
            title = args.getString("title", null),
        )
        invoke.resolveObject(ShareOut.share(host, request))
    }

    @Command
    fun deepLinkConsumePending(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(DeepLinks.consume(host))
    }

    @Command
    fun biometricStatus(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(BiometricLock.status(host))
    }

    @Command
    fun biometricEnable(invoke: Invoke) {
        val activity = host as? androidx.fragment.app.FragmentActivity
        if (activity == null) {
            invoke.reject("the host activity cannot show a biometric prompt", "activity_unavailable")
            return
        }
        BiometricLock.enable(activity) { status ->
            activity.runOnUiThread { invoke.resolveObject(status) }
        }
    }

    @Command
    fun biometricUnlock(invoke: Invoke) {
        val activity = host as? androidx.fragment.app.FragmentActivity
        if (activity == null) {
            invoke.reject("the host activity cannot show a biometric prompt", "activity_unavailable")
            return
        }
        BiometricLock.unlock(activity) { result ->
            activity.runOnUiThread { invoke.resolveObject(result) }
        }
    }

    @Command
    fun biometricLockNow(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(BiometricLock.lockNow(host))
    }

    @Command
    fun biometricDisable(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(BiometricLock.disable(host))
    }

    @Command
    fun vaultPut(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val key = args.getString("key", null)
            ?: return@guarded invoke.reject("key is required", "invalid_vault_key")
        val value = args.getString("value", null)
            ?: return@guarded invoke.reject("value is required", "invalid_vault_value")
        val stored = SecretVault.put(host, key, value)
        if (!stored) {
            invoke.reject("the Android Keystore rejected the value", "vault_write_failed")
            return@guarded
        }
        invoke.resolveObject(mapOf("present" to true, "value" to value))
    }

    @Command
    fun vaultGet(invoke: Invoke) = guarded(invoke) {
        val key = invoke.getArgs().getString("key", null)
            ?: return@guarded invoke.reject("key is required", "invalid_vault_key")
        val value = SecretVault.get(host, key)
        invoke.resolveObject(mapOf("present" to (value != null), "value" to value))
    }

    @Command
    fun vaultDelete(invoke: Invoke) = guarded(invoke) {
        val key = invoke.getArgs().getString("key", null)
            ?: return@guarded invoke.reject("key is required", "invalid_vault_key")
        SecretVault.delete(host, key)
        invoke.resolveObject(mapOf("present" to false, "value" to null))
    }

    @Command
    fun pickImages(invoke: Invoke) {
        val args = invoke.getArgs()
        val max = args.optInt("max", 0).takeIf { it > 0 }
        val intent = Pickers.imagesIntent(host, max)
        if (intent.resolveActivity(host.packageManager) == null) {
            invoke.resolveObject(Pickers.unavailable("no image picker is installed"))
            return
        }
        startActivityForResult(invoke, intent, "pickImagesResult")
    }

    @ActivityCallback
    fun pickImagesResult(invoke: Invoke, result: ActivityResult) {
        val max = invoke.getArgs().optInt("max", 0).takeIf { it > 0 }
        invoke.resolveObject(Pickers.fromResult(host, result, max))
    }

    @Command
    fun pickDocument(invoke: Invoke) {
        val intent = Pickers.documentIntent()
        if (intent.resolveActivity(host.packageManager) == null) {
            invoke.resolveObject(Pickers.unavailable("no document picker is installed"))
            return
        }
        startActivityForResult(invoke, intent, "pickDocumentResult")
    }

    @ActivityCallback
    fun pickDocumentResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolveObject(Pickers.fromResult(host, result, 1))
    }

    @Command
    fun capturePhoto(invoke: Invoke) {
        val pair = Pickers.cameraIntent(host)
        if (pair == null) {
            invoke.resolveObject(Pickers.unavailable("no camera activity is installed"))
            return
        }
        pendingCameraUri = pair.second
        startActivityForResult(invoke, pair.first, "capturePhotoResult")
    }

    @ActivityCallback
    fun capturePhotoResult(invoke: Invoke, result: ActivityResult) {
        val uri = pendingCameraUri
        pendingCameraUri = null
        if (uri == null) {
            invoke.resolveObject(Pickers.unavailable("the camera output was lost"))
            return
        }
        invoke.resolveObject(Pickers.cameraResult(uri, result.resultCode))
    }

    @Command
    fun scanQr(invoke: Invoke) {
        val pair = Pickers.cameraIntent(host)
        if (pair == null) {
            invoke.resolveObject(
                QrScanner.QrResultData(
                    "unavailable",
                    null,
                    null,
                    "no camera activity is installed",
                ),
            )
            return
        }
        pendingQrUri = pair.second
        startActivityForResult(invoke, pair.first, "scanQrResult")
    }

    @ActivityCallback
    fun scanQrResult(invoke: Invoke, result: ActivityResult) {
        val uri = pendingQrUri
        pendingQrUri = null
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolveObject(QrScanner.QrResultData("cancelled", null, null, null))
            return
        }
        decodeQrAsync(invoke, uri)
    }

    @Command
    fun decodeQrImage(invoke: Invoke) {
        val raw = invoke.getArgs().getString("uri", null)
            ?: return invoke.reject("uri is required", "invalid_uri")
        decodeQrAsync(invoke, Uri.parse(raw))
    }

    private fun decodeQrAsync(invoke: Invoke, uri: Uri) {
        Thread {
            val decoded = QrScanner.decode(host, uri)
            host.runOnUiThread { invoke.resolveObject(decoded) }
        }.start()
    }

    @Command
    fun readImageBase64(invoke: Invoke) = guarded(invoke) {
        val uri = invoke.getArgs().getString("uri", null)
            ?: return@guarded invoke.reject("uri is required", "invalid_uri")
        if (uri.length > 4096) {
            invoke.reject("uri is unreasonably long", "invalid_uri")
            return@guarded
        }
        invoke.resolveObject(ImageReader.read(host, uri))
    }

    @Command
    fun saveToDownloads(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val fileName = args.getString("fileName", null)
            ?: return@guarded invoke.reject("fileName is required", "invalid_file_name")
        val mimeType = args.getString("mimeType", null) ?: "application/octet-stream"
        val base64 = args.getString("base64", null)
            ?: return@guarded invoke.reject("base64 is required", "invalid_payload")
        invoke.resolveObject(Downloads.save(host, fileName, mimeType, base64))
    }

    @Command
    fun openWith(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val uri = args.getString("uri", null)
            ?: return@guarded invoke.reject("uri is required", "invalid_uri")
        invoke.resolveObject(Downloads.openWith(host, uri, args.getString("mimeType", null)))
    }

    @Command
    fun clipboardRead(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(ClipboardHaptics.read(host))
    }

    @Command
    fun clipboardWrite(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        val text = args.getString("text", null)
            ?: return@guarded invoke.reject("text is required", "invalid_text")
        invoke.resolveObject(
            ClipboardHaptics.write(host, text, args.getBoolean("sensitive", false)),
        )
    }

    @Command
    fun haptic(invoke: Invoke) = guarded(invoke) {
        val kind = invoke.getArgs().getString("kind", null) ?: "light"
        invoke.resolveObject(ClipboardHaptics.haptic(host, kind))
    }

    @Command
    fun insetsSnapshot(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(LayoutState.snapshot())
    }

    @Command
    fun layoutStatus(invoke: Invoke) = guarded(invoke) {
        invoke.resolveObject(LayoutState.status())
    }

    @Command
    fun refreshShortcuts(invoke: Invoke) = guarded(invoke) {
        val args = invoke.getArgs()
        invoke.resolveObject(
            AppShortcuts.refresh(
                host,
                args.getString("recentSessionId", null),
                args.getString("recentSessionLabel", null),
            ),
        )
    }

    @Command
    fun textSelectionNoop(invoke: Invoke) = guarded(invoke) {
        // Deliberately does nothing to the WebView selection. Text selection in
        // the webview stays entirely native to the web engine.
        invoke.resolveObject(
            mapOf("written" to true, "error" to null),
        )
    }

    private var pendingCameraUri: Uri? = null
    private var pendingQrUri: Uri? = null

    private inline fun guarded(invoke: Invoke, block: () -> Unit) {
        try {
            block()
        } catch (error: Exception) {
            Log.w("JCodeNativeBridge", "native command failed", error)
            invoke.reject(error.message ?: "native command failed", "native_error")
        }
    }
}
