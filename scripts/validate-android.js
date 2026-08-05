const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "android/settings.gradle.kts",
  "android/app/build.gradle.kts",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/java/tw/xiaokebiao/shell/MainActivity.java",
  ".github/workflows/android-release.yml",
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Android file: ${file}`);
}

const java = fs.readFileSync(path.join(root, required[3]), "utf8");
const manifest = fs.readFileSync(path.join(root, required[2]), "utf8");
const workflow = fs.readFileSync(path.join(root, required[4]), "utf8");
const gradle = fs.readFileSync(path.join(root, required[1]), "utf8");
const gradleProperties = fs.readFileSync(path.join(root, "android/gradle.properties"), "utf8");

const checks = [
  [java.includes("/releases/latest"), "latest stable GitHub Release endpoint"],
  [java.includes("DownloadManager"), "DownloadManager"],
  [java.includes("FileProvider.getUriForFile"), "FileProvider install URI"],
  [java.includes("ACTION_MANAGE_UNKNOWN_APP_SOURCES"), "Android 8+ unknown sources settings"],
  [java.includes("ACTION_VIEW"), "Android system installer intent"],
  [java.includes("archive.packageName"), "APK package name verification"],
  [java.includes("signatureDigests"), "APK signature verification"],
  [java.includes("archiveVersion <= currentVersion"), "versionCode verification"],
  [java.includes('!lower.contains("debug")'), "debug APK rejection"],
  [java.includes("ERROR_CANNOT_RESUME"), "interrupted download handling"],
  [java.includes("ERROR_INSUFFICIENT_SPACE"), "insufficient storage handling"],
  [java.includes("installerLaunched"), "cancelled installer recovery state"],
  [manifest.includes("REQUEST_INSTALL_PACKAGES"), "package install permission"],
  [manifest.includes("POST_NOTIFICATIONS"), "Android notification permission"],
  [manifest.includes('android:allowBackup="true"'), "Android app data preservation"],
  [gradle.includes("XIAOKEBIAO_APPLICATION_ID"), "explicit applicationId configuration"],
  [gradle.includes('permanentApplicationId = "io.github.lobster0213.xiaokebiao"'), "confirmed permanent applicationId"],
  [workflow.includes("ANDROID_KEYSTORE_BASE64"), "release signing secrets"],
  [workflow.includes("xiaokebiao-v${VERSION_NAME}-release.apk"), "release-only APK name"],
  [workflow.includes("--prerelease"), "prerelease tag handling"],
  [gradleProperties.includes("XIAOKEBIAO_VERSION_CODE=8000"), "v0.8 versionCode"],
  [java.includes("showCreditReminder"), "daily credit reminder bridge"],
];

for (const [passed, label] of checks) {
  if (!passed) throw new Error(`Android validation failed: ${label}`);
}

console.log(`Android static validation passed (${checks.length} checks).`);
