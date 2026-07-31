package tw.xiaokebiao.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String GITHUB_OWNER = "Lobster0213";
    private static final String GITHUB_REPO = "xiaokebiao";
    private static final String RELEASE_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/releases/latest";
    private static final String PREFS = "xiaokebiao_update";
    private static final String APK_FILENAME = "xiaokebiao-release-update.apk";
    private static final int UNKNOWN_SOURCES_REQUEST = 4107;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private SharedPreferences prefs;
    private DownloadManager downloadManager;
    private long activeDownloadId = -1L;
    private String releaseVersion = "";
    private String releaseNotes = "";
    private String apkUrl = "";
    private String apkName = "";
    private long apkSize = 0L;
    private String updateStatus = "idle";
    private String updateMessage = "";
    private int downloadProgress = 0;
    private boolean awaitingUnknownSources = false;
    private boolean installerLaunched = false;

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (completedId == activeDownloadId) inspectCompletedDownload();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        activeDownloadId = prefs.getLong("downloadId", -1L);
        registerDownloadReceiver();

        webView = new WebView(this);
        webView.setBackgroundColor(0xfff5f8ff);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(false);
        webView.addJavascriptInterface(new UpdateBridge(), "AndroidUpdater");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"file".equalsIgnoreCase(uri.getScheme());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushStateToWeb();
                if (prefs.getBoolean("autoCheck", true)) checkForUpdates(false);
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
        if (activeDownloadId >= 0) handler.postDelayed(this::pollDownloadProgress, 500);
    }

    private void registerDownloadReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(downloadReceiver);
        handler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (awaitingUnknownSources && canInstallUnknownApps()) {
            awaitingUnknownSources = false;
            installDownloadedApk();
        } else if (installerLaunched) {
            installerLaunched = false;
            setState("ready", "安裝尚未完成；你可以再次點「繼續安裝」");
        }
    }

    private void checkForUpdates(boolean userInitiated) {
        setState("checking", "正在檢查 GitHub 最新正式版本…");
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(RELEASE_API).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                connection.setRequestProperty("User-Agent", "XiaoKeBiao-Android/" + BuildConfig.VERSION_NAME);
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) throw new IllegalStateException("GitHub API 回應 " + status);
                JSONObject release = new JSONObject(readAll(connection.getInputStream()));
                if (release.optBoolean("draft", true) || release.optBoolean("prerelease", true)) {
                    throw new IllegalStateException("最新項目不是正式 Release");
                }
                String version = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                JSONArray assets = release.optJSONArray("assets");
                JSONObject selected = null;
                if (assets != null) {
                    for (int index = 0; index < assets.length(); index++) {
                        JSONObject asset = assets.getJSONObject(index);
                        String name = asset.optString("name", "");
                        String lower = name.toLowerCase(Locale.ROOT);
                        boolean releaseApk = lower.endsWith(".apk")
                                && lower.contains("release")
                                && !lower.contains("debug")
                                && !lower.contains("unsigned")
                                && !lower.contains("test")
                                && !lower.contains("source");
                        if (releaseApk) {
                            selected = asset;
                            break;
                        }
                    }
                }
                releaseVersion = version;
                releaseNotes = release.optString("body", "");
                prefs.edit().putString("lastCheckedAt", java.time.Instant.now().toString()).apply();
                if (compareVersions(version, BuildConfig.VERSION_NAME) <= 0) {
                    apkUrl = "";
                    setState("current", userInitiated ? "目前已是最新版本" : "");
                } else if (selected == null) {
                    apkUrl = "";
                    setState("error", "找到新版 " + version + "，但 Release 沒有可用的 release APK");
                } else {
                    apkUrl = selected.optString("browser_download_url", "");
                    apkName = selected.optString("name", "");
                    apkSize = selected.optLong("size", 0L);
                    if (!apkUrl.startsWith("https://")) throw new IllegalStateException("APK 下載網址不安全");
                    setState("available", "有新版本 " + version);
                }
            } catch (Exception error) {
                setState("error", "檢查更新失敗：" + safeMessage(error));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void startDownload() {
        if (apkUrl.isEmpty()) {
            checkForUpdates(true);
            return;
        }
        try {
            File existing = downloadedApkFile();
            if (existing.exists() && !existing.delete()) throw new IllegalStateException("無法移除舊的更新檔");
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
            request.setTitle("小課表 " + releaseVersion);
            request.setDescription("正在下載安全更新");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, APK_FILENAME);
            if (prefs.getBoolean("wifiOnly", true)) {
                request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI);
            }
            activeDownloadId = downloadManager.enqueue(request);
            prefs.edit().putLong("downloadId", activeDownloadId).putString("downloadedVersion", releaseVersion).apply();
            downloadProgress = 0;
            setState("downloading", prefs.getBoolean("wifiOnly", true) ? "等待 Wi-Fi 或正在下載…" : "正在下載…");
            pollDownloadProgress();
        } catch (Exception error) {
            setState("error", "無法開始下載：" + safeMessage(error));
        }
    }

    private void pollDownloadProgress() {
        if (activeDownloadId < 0) return;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(activeDownloadId);
        try (android.database.Cursor cursor = downloadManager.query(query)) {
            if (cursor != null && cursor.moveToFirst()) {
                int downloaded = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                int total = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (total > 0) downloadProgress = Math.min(100, Math.max(0, (downloaded * 100) / total));
                pushStateToWeb();
                if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                    handler.postDelayed(this::pollDownloadProgress, 700);
                } else if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
                    inspectCompletedDownload();
                }
            }
        } catch (Exception error) {
            setState("error", "讀取下載進度失敗：" + safeMessage(error));
        }
    }

    private void inspectCompletedDownload() {
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(activeDownloadId);
        try (android.database.Cursor cursor = downloadManager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IllegalStateException("找不到下載紀錄");
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                throw new IllegalStateException(downloadFailureMessage(reason));
            }
            downloadProgress = 100;
            verifyDownloadedApk();
            prefs.edit().putString("downloadedApkPath", downloadedApkFile().getAbsolutePath()).apply();
            setState("ready", "下載完成，等待 Android 系統安裝確認");
            runOnUiThread(this::installDownloadedApk);
        } catch (Exception error) {
            setState("error", "下載未完成：" + safeMessage(error));
        }
    }

    private void verifyDownloadedApk() throws Exception {
        File file = downloadedApkFile();
        if (!file.isFile() || file.length() <= 0) throw new IllegalStateException("APK 檔案遺失或為空");
        PackageManager manager = getPackageManager();
        PackageInfo archive;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        } else {
            archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        }
        if (archive == null) throw new IllegalStateException("APK 已損毀或格式不正確");
        if (!BuildConfig.APPLICATION_ID.equals(archive.packageName)) throw new IllegalStateException("APK package name 不符合目前 App");
        long archiveVersion = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? archive.getLongVersionCode() : archive.versionCode;
        long currentVersion = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode()
                : getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        if (archiveVersion <= currentVersion) throw new IllegalStateException("APK versionCode 必須高於目前版本");
        Set<String> currentSignatures = signatureDigests(getPackageManager().getPackageInfo(
                getPackageName(),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES
        ));
        Set<String> archiveSignatures = signatureDigests(archive);
        if (currentSignatures.isEmpty() || !currentSignatures.equals(archiveSignatures)) {
            throw new IllegalStateException("APK 簽章與目前 App 不一致，已停止安裝");
        }
    }

    private Set<String> signatureDigests(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        Set<String> output = new HashSet<>();
        if (signatures == null) return output;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) output.add(bytesToHex(digest.digest(signature.toByteArray())));
        return output;
    }

    private void installDownloadedApk() {
        try {
            verifyDownloadedApk();
            if (!canInstallUnknownApps()) {
                new AlertDialog.Builder(this)
                        .setTitle("允許安裝小課表更新")
                        .setMessage("Android 需要你允許「小課表」安裝未知應用程式。只會安裝簽章與目前 App 相同、versionCode 較高的正式 Release APK。")
                        .setNegativeButton("稍後", null)
                        .setPositiveButton("前往設定", (dialog, which) -> {
                            awaitingUnknownSources = true;
                            Intent settingsIntent = new Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName())
                            );
                            startActivityForResult(settingsIntent, UNKNOWN_SOURCES_REQUEST);
                        })
                        .show();
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(
                    this,
                    BuildConfig.APPLICATION_ID + ".fileprovider",
                    downloadedApkFile()
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            installerLaunched = true;
            setState("installing", "已開啟 Android 系統安裝確認");
            startActivity(installIntent);
        } catch (Exception error) {
            setState("error", "無法開啟系統安裝畫面：" + safeMessage(error));
        }
    }

    private boolean canInstallUnknownApps() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
    }

    private File downloadedApkFile() {
        return new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILENAME);
    }

    private String downloadFailureMessage(int reason) {
        if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "儲存空間不足";
        if (reason == DownloadManager.ERROR_CANNOT_RESUME) return "下載中斷且無法繼續";
        if (reason == DownloadManager.ERROR_FILE_ERROR) return "無法寫入 APK 檔案";
        if (reason == DownloadManager.ERROR_HTTP_DATA_ERROR || reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE) return "下載伺服器回應錯誤";
        return "下載失敗（代碼 " + reason + "）";
    }

    private int compareVersions(String first, String second) {
        String[] left = first.replaceFirst("^[vV]", "").split("[-+]")[0].split("\\.");
        String[] right = second.replaceFirst("^[vV]", "").split("[-+]")[0].split("\\.");
        int length = Math.max(left.length, right.length);
        for (int index = 0; index < length; index++) {
            int leftPart = index < left.length ? parseVersionPart(left[index]) : 0;
            int rightPart = index < right.length ? parseVersionPart(right[index]) : 0;
            if (leftPart != rightPart) return Integer.compare(leftPart, rightPart);
        }
        return 0;
    }

    private int parseVersionPart(String value) {
        try {
            return Integer.parseInt(value.replaceAll("[^0-9]", ""));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private String readAll(InputStream input) throws Exception {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line);
        }
        return output.toString();
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder output = new StringBuilder();
        for (byte value : bytes) output.append(String.format(Locale.ROOT, "%02x", value));
        return output.toString();
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private void setState(String status, String message) {
        updateStatus = status;
        updateMessage = message;
        pushStateToWeb();
    }

    private JSONObject stateJson() {
        JSONObject object = new JSONObject();
        try {
            object.put("native", true);
            object.put("currentVersion", BuildConfig.VERSION_NAME);
            object.put("currentVersionCode", BuildConfig.VERSION_CODE);
            object.put("status", updateStatus);
            object.put("message", updateMessage);
            object.put("latestVersion", releaseVersion);
            object.put("releaseNotes", releaseNotes);
            object.put("apkName", apkName);
            object.put("apkSize", apkSize);
            object.put("downloadProgress", downloadProgress);
            object.put("autoCheck", prefs.getBoolean("autoCheck", true));
            object.put("wifiOnly", prefs.getBoolean("wifiOnly", true));
            object.put("lastCheckedAt", prefs.getString("lastCheckedAt", ""));
            object.put("hasDownloadedApk", downloadedApkFile().isFile());
        } catch (Exception ignored) {
        }
        return object;
    }

    private void pushStateToWeb() {
        if (webView == null) return;
        String json = JSONObject.quote(stateJson().toString());
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onAndroidUpdateState&&window.onAndroidUpdateState(JSON.parse(" + json + "));",
                null
        ));
    }

    public final class UpdateBridge {
        @JavascriptInterface
        public String getState() {
            return stateJson().toString();
        }

        @JavascriptInterface
        public void checkForUpdates() {
            MainActivity.this.checkForUpdates(true);
        }

        @JavascriptInterface
        public void downloadAndInstall() {
            runOnUiThread(MainActivity.this::startDownload);
        }

        @JavascriptInterface
        public void continueInstall() {
            runOnUiThread(MainActivity.this::installDownloadedApk);
        }

        @JavascriptInterface
        public void setAutoCheck(boolean enabled) {
            prefs.edit().putBoolean("autoCheck", enabled).apply();
            pushStateToWeb();
        }

        @JavascriptInterface
        public void setWifiOnly(boolean enabled) {
            prefs.edit().putBoolean("wifiOnly", enabled).apply();
            pushStateToWeb();
        }
    }
}
