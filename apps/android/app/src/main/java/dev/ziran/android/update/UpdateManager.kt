package dev.ziran.android.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import dev.ziran.android.data.UpdateReleaseInfo
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * In-app version control & self-updater backed by the GitHub Releases JSON API.
 *
 * - Checks `https://api.github.com/repos/ddawnlll/ziran/releases/latest`.
 * - Compares semver against [dev.ziran.android.BuildConfig.VERSION_NAME].
 * - Downloads the signed release APK into `cacheDir/updates/`, verifies its
 *   SHA-256 digest when a `.sha256` asset is published alongside it, and hands
 *   the file to Android's package installer via FileProvider.
 */
object UpdateManager {

    const val DEFAULT_RELEASES_API_URL = "https://api.github.com/repos/ddawnlll/ziran/releases/latest"

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    sealed interface CheckResult {
        data class UpdateAvailable(val release: UpdateReleaseInfo) : CheckResult
        data class UpToDate(val latestVersion: String) : CheckResult
        data class Failed(val message: String) : CheckResult
    }

    enum class InstallLaunchResult { LAUNCHED, NEEDS_UNKNOWN_SOURCES_PERMISSION }

    /** Extract `(major, minor, patch)` from strings like `0.7.4`, `v0.7.4`, `ziran-v0.7.4`. */
    fun parseSemVer(raw: String): Triple<Int, Int, Int>? {
        val match = Regex("(\\d+)\\.(\\d+)\\.(\\d+)").find(raw.trim()) ?: return null
        val major = match.groupValues[1].toIntOrNull() ?: return null
        val minor = match.groupValues[2].toIntOrNull() ?: return null
        val patch = match.groupValues[3].toIntOrNull() ?: return null
        return Triple(major, minor, patch)
    }

    /** True strictly when [candidate] is a higher semantic version than [current]. */
    fun isNewerVersion(candidate: String, current: String): Boolean {
        val c = parseSemVer(candidate) ?: return false
        val cur = parseSemVer(current) ?: return false
        if (c.first != cur.first) return c.first > cur.first
        if (c.second != cur.second) return c.second > cur.second
        return c.third > cur.third
    }

    /** Parse a GitHub `/releases/latest` JSON payload into [UpdateReleaseInfo]. */
    fun parseGitHubReleaseJson(rawJson: String): UpdateReleaseInfo? {
        val root = runCatching { json.parseToJsonElement(rawJson) as? JsonObject }.getOrNull() ?: return null
        val tagName = (root["tag_name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val versionTriple = parseSemVer(tagName) ?: return null
        val version = "${versionTriple.first}.${versionTriple.second}.${versionTriple.third}"
        val title = (root["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty().ifEmpty { "Ziran $version" }
        val notes = (root["body"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val htmlUrl = (root["html_url"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val assets = root["assets"] as? JsonArray ?: return null

        val parsedAssets = assets.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val name = (obj["name"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val url = (obj["browser_download_url"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val size = (obj["size"] as? JsonPrimitive)?.longOrNull ?: 0L
            Triple(name, url, size)
        }
        // Prefer the R8 release APK; fall back to any non-debug APK.
        val apk = parsedAssets.firstOrNull { (name, _, _) ->
            name.endsWith(".apk", ignoreCase = true) && name.contains("release", ignoreCase = true)
        } ?: parsedAssets.firstOrNull { (name, _, _) ->
            name.endsWith(".apk", ignoreCase = true) && !name.contains("debug", ignoreCase = true)
        } ?: parsedAssets.firstOrNull { (name, _, _) ->
            name.endsWith(".apk", ignoreCase = true)
        } ?: return null

        val shaAsset = parsedAssets.firstOrNull { (name, _, _) ->
            name.equals("${apk.first}.sha256", ignoreCase = true)
        }

        return UpdateReleaseInfo(
            version = version,
            tagName = tagName,
            title = title,
            notes = notes,
            apkUrl = apk.second,
            apkName = apk.first,
            apkSizeBytes = apk.third,
            sha256Url = shaAsset?.second,
            htmlUrl = htmlUrl,
        )
    }

    suspend fun checkLatestRelease(
        http: OkHttpClient,
        currentVersion: String,
        apiUrl: String = DEFAULT_RELEASES_API_URL,
    ): CheckResult = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url(apiUrl)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "Ziran-Android/$currentVersion")
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return@withContext CheckResult.Failed("GitHub returned HTTP ${resp.code}.")
                }
                val body = resp.body?.string().orEmpty()
                val release = parseGitHubReleaseJson(body)
                    ?: return@withContext CheckResult.Failed("Release metadata did not include an Android APK.")
                if (isNewerVersion(release.version, currentVersion)) {
                    CheckResult.UpdateAvailable(release)
                } else {
                    CheckResult.UpToDate(release.version)
                }
            }
        } catch (error: Exception) {
            CheckResult.Failed(error.message?.takeIf { it.isNotBlank() } ?: "Could not reach GitHub.")
        }
    }

    suspend fun downloadAndVerifyApk(
        context: Context,
        http: OkHttpClient,
        release: UpdateReleaseInfo,
        onProgress: (Int) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        // Clean previous APKs so cache never grows unboundedly.
        dir.listFiles()?.forEach { old -> if (old.name != release.apkName) old.delete() }

        val target = File(dir, release.apkName)
        val tmp = File(dir, "${release.apkName}.part")

        val req = Request.Builder()
            .url(release.apkUrl)
            .header("User-Agent", "Ziran-Android")
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) error("Download failed (HTTP ${resp.code}).")
            val body = resp.body ?: error("Empty download response.")
            val total = body.contentLength().takeIf { it > 0L } ?: release.apkSizeBytes
            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L
            var lastPct = -1
            body.byteStream().use { input ->
                FileOutputStream(tmp).use { out ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        downloaded += n
                        if (total > 0L) {
                            val pct = ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                            if (pct != lastPct) {
                                lastPct = pct
                                onProgress(pct)
                            }
                        }
                    }
                }
            }
            val actualSha = digest.digest().joinToString("") { "%02x".format(it) }
            if (!release.sha256Url.isNullOrBlank()) {
                val expectedSha = fetchExpectedSha256(http, release.sha256Url)
                if (expectedSha != null && !expectedSha.equals(actualSha, ignoreCase = true)) {
                    tmp.delete()
                    error("APK checksum verification failed. Download was discarded.")
                }
            }
        }
        if (target.exists()) target.delete()
        if (!tmp.renameTo(target)) {
            tmp.copyTo(target, overwrite = true)
            tmp.delete()
        }
        onProgress(100)
        target
    }

    private fun fetchExpectedSha256(http: OkHttpClient, url: String): String? = runCatching {
        val req = Request.Builder().url(url).header("User-Agent", "Ziran-Android").build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@runCatching null
            val text = resp.body?.string()?.trim().orEmpty()
            parseSha256Line(text)
        }
    }.getOrNull()

    fun parseSha256Line(raw: String): String? {
        val token = raw.trim().split(Regex("\\s+")).firstOrNull().orEmpty()
        return if (token.matches(Regex("^[0-9a-fA-F]{64}$"))) token.lowercase() else null
    }

    fun launchApkInstaller(context: Context, apkFile: File): InstallLaunchResult {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val permIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(permIntent)
            return InstallLaunchResult.NEEDS_UNKNOWN_SOURCES_PERMISSION
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(installIntent)
        return InstallLaunchResult.LAUNCHED
    }
}
