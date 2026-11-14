package dev.jcode.stillness.native

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Biometric app lock with an explicit device-credential fallback.
 *
 * The gate is a real AndroidX BiometricPrompt. The lock secret is a random value
 * held in [SecretVault] (Android Keystore AES-GCM). Because the prompt allows
 * device credentials, no CryptoObject is bound to the prompt: the platform does
 * not support `CryptoObject` together with `DEVICE_CREDENTIAL`. The lock state is
 * therefore a real authenticated gate plus a keystore-backed secret, and this
 * documentation says exactly that rather than claiming hardware-bound key
 * release.
 *
 * Device-credential fallback requires Android 11 (API 30) or newer. On older
 * versions only biometrics are available; a device with no enrolled biometrics
 * reports the feature unavailable instead of silently unlocking.
 */
object BiometricLock {
    private const val TAG = "JCodeBiometricLock"
    private const val PREFS = "jcode_lock"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_LOCKED = "locked"
    const val VAULT_KEY = "lockSecret"

    data class BiometricStatusData(
        val enabled: Boolean,
        val locked: Boolean,
        val available: Boolean,
        val enrolled: Boolean,
        val method: String,
        val secretStored: Boolean,
        val message: String,
    )

    data class BiometricUnlockData(
        val unlocked: Boolean,
        val status: String,
        val message: String,
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun authenticators(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        }

    private fun enrollState(context: Context): Int =
        BiometricManager.from(context).canAuthenticate(authenticators())

    fun status(context: Context): BiometricStatusData {
        val stored = prefs(context)
        val enabled = stored.getBoolean(KEY_ENABLED, false)
        val locked = enabled && stored.getBoolean(KEY_LOCKED, false)
        val result = enrollState(context)
        val available = result == BiometricManager.BIOMETRIC_SUCCESS
        val method = when {
            !available -> "none"
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> "biometric_or_device_credential"
            else -> "biometric"
        }
        val message = when (result) {
            BiometricManager.BIOMETRIC_SUCCESS -> "Ready"
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    "No biometric or device credential is enrolled"
                } else {
                    "No biometric is enrolled; device-credential fallback needs Android 11+"
                }
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "This device has no biometric hardware"
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "Biometric hardware is unavailable"
            else -> "Biometric authentication is unavailable"
        }
        return BiometricStatusData(
            enabled = enabled,
            locked = locked,
            available = available,
            enrolled = available,
            method = method,
            secretStored = SecretVault.has(context, VAULT_KEY),
            message = message,
        )
    }

    fun enable(activity: FragmentActivity, callback: (BiometricStatusData) -> Unit) {
        val context = activity.applicationContext
        val current = status(context)
        if (!current.available) {
            callback(current)
            return
        }
        if (current.enabled) {
            callback(current)
            return
        }
        val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
            .joinToString("") { "%02x".format(it) }
        if (!SecretVault.put(context, VAULT_KEY, secret)) {
            callback(
                current.copy(
                    message = "The Android Keystore rejected the lock secret",
                ),
            )
            return
        }
        prompt(
            activity,
            title = "Enable app lock",
            subtitle = "Confirm it is you to enable the JCode lock",
            onSuccess = {
                prefs(context).edit()
                    .putBoolean(KEY_ENABLED, true)
                    .putBoolean(KEY_LOCKED, false)
                    .apply()
                val updated = status(context)
                NativeEvents.emit("lockStateChanged", updated)
                callback(updated)
            },
            onFailure = { message ->
                SecretVault.delete(context, VAULT_KEY)
                callback(
                    current.copy(
                        enabled = false,
                        locked = false,
                        secretStored = false,
                        message = message,
                    ),
                )
            },
        )
    }

    fun unlock(activity: FragmentActivity, callback: (BiometricUnlockData) -> Unit) {
        val context = activity.applicationContext
        val current = status(context)
        when {
            !current.enabled -> callback(
                BiometricUnlockData(true, "not_enabled", "App lock is not enabled"),
            )
            !current.locked -> callback(
                BiometricUnlockData(true, "approved", "App lock is already open"),
            )
            !current.available -> callback(
                BiometricUnlockData(false, "unavailable", current.message),
            )
            else -> prompt(
                activity,
                title = "Unlock JCode",
                subtitle = "Confirm it is you to continue",
                onSuccess = {
                    if (!SecretVault.has(context, VAULT_KEY)) {
                        callback(
                            BiometricUnlockData(
                                false,
                                "unavailable",
                                "The lock secret is missing; disable and re-enable app lock",
                            ),
                        )
                        return@prompt
                    }
                    prefs(context).edit().putBoolean(KEY_LOCKED, false).apply()
                    val updated = status(context)
                    NativeEvents.emit("lockStateChanged", updated)
                    callback(BiometricUnlockData(true, "approved", "Unlocked"))
                },
                onFailure = { message ->
                    callback(BiometricUnlockData(false, "cancelled", message))
                },
            )
        }
    }

    fun lockNow(context: Context): BiometricStatusData {
        val current = status(context)
        if (!current.enabled) return current
        prefs(context).edit().putBoolean(KEY_LOCKED, true).apply()
        val updated = status(context)
        NativeEvents.emit("lockStateChanged", updated)
        return updated
    }

    fun disable(context: Context): BiometricStatusData {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, false)
            .putBoolean(KEY_LOCKED, false)
            .apply()
        SecretVault.delete(context, VAULT_KEY)
        val updated = status(context)
        NativeEvents.emit("lockStateChanged", updated)
        return updated
    }

    private fun prompt(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        onSuccess: () -> Unit,
        onFailure: (String) -> Unit,
    ) {
        val finished = AtomicBoolean(false)
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    if (!finished.compareAndSet(false, true)) return
                    onSuccess()
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence,
                ) {
                    if (!finished.compareAndSet(false, true)) return
                    Log.i(TAG, "authentication error $errorCode: $errString")
                    onFailure(errString.toString())
                }

                override fun onAuthenticationFailed() {
                    // The prompt stays up for another attempt.
                }
            },
        )
        val authenticators = authenticators()
        val builder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(authenticators)
        if (authenticators == BiometricManager.Authenticators.BIOMETRIC_WEAK) {
            builder.setNegativeButtonText("Cancel")
        }
        try {
            prompt.authenticate(builder.build())
        } catch (error: Exception) {
            if (finished.compareAndSet(false, true)) {
                onFailure(error.message ?: "The biometric prompt could not start")
            }
        }
    }
}
