package dev.ziran.android.persistence

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Secret store backed by an Android Keystore AES-GCM key. Ported from
 * apps/stillness SecretVault.kt. Protects bytes at rest from other apps and
 * raw preference dumps. Not hardware-bound key release, and not a promise
 * against a rooted device while the app is running.
 */
object SecretVault {
    private const val TAG = "ZiranSecretVault"
    private const val PREFS = "ziran_secret_vault"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "ziran.vault.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun secretKey(): SecretKey {
        val store = keyStore()
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    fun put(context: Context, key: String, value: String): Boolean {
        require(key.isNotBlank()) { "vault key must not be blank" }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val iv = cipher.iv
            val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val packed = ByteArray(iv.size + encrypted.size)
            System.arraycopy(iv, 0, packed, 0, iv.size)
            System.arraycopy(encrypted, 0, packed, iv.size, encrypted.size)
            prefs(context).edit().putString(key, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
            true
        } catch (error: Exception) {
            Log.w(TAG, "could not store a vault value", error)
            false
        }
    }

    fun get(context: Context, key: String): String? {
        val encoded = prefs(context).getString(key, null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            if (packed.size <= IV_BYTES) return null
            val iv = packed.copyOfRange(0, IV_BYTES)
            val payload = packed.copyOfRange(IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(payload), Charsets.UTF_8)
        } catch (error: Exception) {
            Log.w(TAG, "could not read a vault value", error)
            null
        }
    }

    fun has(context: Context, key: String): Boolean = prefs(context).contains(key)

    fun delete(context: Context, key: String) {
        prefs(context).edit().remove(key).apply()
    }
}
