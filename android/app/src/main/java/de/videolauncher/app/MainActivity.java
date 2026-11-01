package de.videolauncher.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/** Zeigt die Weboberfläche des eingebauten Servers in einer WebView an. */
public class MainActivity extends Activity {
    private WebView web;
    private View splash;
    private TextView splashText;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private volatile boolean playing = false;
    private String pendingPath = "/";
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0f0f0f"));
        w.setNavigationBarColor(Color.parseColor("#0f0f0f"));

        askNotificationsOnce();
        installCrashLogger();
        startServer();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0f0f0f"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f0f0f"));
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setupWebView();
        pendingPath = pathFromIntent(getIntent());
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        waitForServer();
    }

    private static final int REQ_NOTIFICATIONS = 1;
    private static final String PREFS = "vl";
    private static final String KEY_NOTIF_ASKED = "notificationsAsked";

    /**
     * Fragt nur ein einziges Mal nach der Erlaubnis für Benachrichtigungen.
     * Die Antwort (auch „Nicht zulassen“) wird gespeichert – danach fragt die
     * App nie wieder, auch nicht nach Neustart, Drehen oder Bild-im-Bild.
     * Ändern lässt es sich jederzeit in den Android-Einstellungen der App.
     */
    private void askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(KEY_NOTIF_ASKED, false)) return;
        // Sofort merken – auch wenn der Dialog weggewischt oder die App beendet wird.
        prefs.edit().putBoolean(KEY_NOTIF_ASKED, true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(KEY_NOTIF_ASKED, true)
                    .putBoolean("notificationsAllowed", grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED)
                    .apply();
        }
    }

    /** Startet den Server-Dienst (eigener Prozess ":node"). */
    private void startServer() {
        Intent svc = new Intent(this, NodeService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
            else startService(svc);
        } catch (Exception e) {
            // z. B. wenn Android Vordergrunddienste gerade nicht erlaubt → normal starten.
            try {
                startService(svc);
            } catch (Exception e2) {
                lastUiError = e2.toString();
            }
        }
    }

    private String lastUiError = null;

    /** Schreibt Abstürze der Oberfläche in eine Datei, damit sie beim nächsten Start angezeigt werden. */
    private void installCrashLogger() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        final java.io.File crash = new java.io.File(getFilesDir(), "ui-crash.txt");
        Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
            try (java.io.PrintWriter pw = new java.io.PrintWriter(new java.io.FileWriter(crash))) {
                ex.printStackTrace(pw);
            } catch (java.io.IOException ignored) {
            }
            if (prev != null) prev.uncaughtException(thread, ex);
        });
        if (crash.exists()) {
            try {
                lastUiError = "Letzter Absturz:\n" + NodeBridge.readFile(crash);
            } catch (java.io.IOException ignored) {
            }
            //noinspection ResultOfMethodCallIgnored
            crash.delete();
        }
    }

    private void showError(String msg) {
        String log = NodeBridge.getLogTail(this, 4000);
        final String report = msg + "\n\n--- Log ---\n" + log + (lastUiError != null ? "\n\n" + lastUiError : "");
        splashText.setText(getString(R.string.start_failed, msg) + "\n\n" + log);
        splashText.setTextIsSelectable(true);
        if (splashButtons.getChildCount() > 0) return;
        android.widget.Button copy = new android.widget.Button(this);
        copy.setText(R.string.copy_report);
        copy.setOnClickListener(v -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("Video Launcher Fehlerbericht", report));
            Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
        });
        android.widget.Button retry = new android.widget.Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> {
            splashText.setText(R.string.starting);
            startServer();
            waitForServer();
        });
        splashButtons.addView(copy);
        splashButtons.addView(retry);
    }

    private LinearLayout splashButtons;

    private View buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        ProgressBar pb = new ProgressBar(this);
        box.addView(pb);
        splashText = new TextView(this);
        splashText.setTextColor(Color.parseColor("#aaaaaa"));
        splashText.setPadding(48, 32, 48, 0);
        splashText.setGravity(Gravity.CENTER);
        splashText.setText(R.string.starting);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(splashText);
        box.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        splashButtons = new LinearLayout(this);
        splashButtons.setGravity(Gravity.CENTER);
        box.addView(splashButtons);
        box.setPadding(0, 160, 0, 80);
        return box;
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        // Kein Zoomen mit zwei Fingern.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "VLAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("127.0.0.1".equals(host) || "localhost".equals(host)) return false;
                // YouTube-Links in der App öffnen, alles andere im Browser.
                String internal = mapYouTubeUri(uri);
                if (internal != null) {
                    view.loadUrl(NodeBridge.BASE_URL + internal);
                    return true;
                }
                openExternal(uri);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setFullscreenUi(true);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
                customViewCallback = null;
                setFullscreenUi(false);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setTitle(name);
                req.setMimeType(mimeType);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void waitForServer() {
        new Thread(() -> {
            long until = System.currentTimeMillis() + 90_000;
            while (System.currentTimeMillis() < until) {
                if (NodeBridge.isReady()) {
                    ui.post(this::showApp);
                    return;
                }
                String err = NodeBridge.getStartError(this);
                if (err != null) {
                    ui.post(() -> showError(err));
                    return;
                }
                try {
                    Thread.sleep(300);
                } catch (InterruptedException e) {
                    return;
                }
            }
            ui.post(() -> showError("Zeitüberschreitung beim Start"));
        }, "wait-server").start();
    }

    private void showApp() {
        if (web.getUrl() == null) web.loadUrl(NodeBridge.BASE_URL + pendingPath);
        web.setVisibility(View.VISIBLE);
        splash.setVisibility(View.GONE);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String path = pathFromIntent(intent);
        if (splash.getVisibility() == View.GONE) web.loadUrl(NodeBridge.BASE_URL + path);
        else pendingPath = path;
    }

    /** Übersetzt geteilte oder geöffnete YouTube-Links in einen App-Pfad. */
    private String pathFromIntent(Intent intent) {
        if (intent == null) return "/";
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("https?://\\S+").matcher(text);
                if (m.find()) uri = Uri.parse(m.group());
            }
        }
        if (uri == null) return "/";
        String p = mapYouTubeUri(uri);
        return p != null ? p : "/";
    }

    static String mapYouTubeUri(Uri uri) {
        String host = uri.getHost();
        if (host == null) return null;
        host = host.toLowerCase();
        if (host.equals("youtu.be")) {
            String id = uri.getPath() == null ? "" : uri.getPath().replace("/", "");
            String t = uri.getQueryParameter("t");
            return "/watch?v=" + id + (t != null ? "&t=" + t : "");
        }
        if (host.equals("youtube.com") || host.endsWith(".youtube.com")) {
            String path = uri.getEncodedPath() == null ? "/" : uri.getEncodedPath();
            String q = uri.getEncodedQuery();
            return path + (q != null ? "?" + q : "");
        }
        return null;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void setFullscreenUi(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    // Beim Verlassen der App mit laufendem Video: Bild-im-Bild.
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (playing && Build.VERSION.SDK_INT >= 26) {
            try {
                enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build());
            } catch (IllegalStateException ignored) {
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPip, newConfig);
        web.evaluateJavascript("document.body.classList.toggle('android-pip', " + isInPip + ")", null);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            web.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null);
            return;
        }
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    private static final int REQ_LOGIN = 42;

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_LOGIN) {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('vl-login-done', { detail: " + (resultCode == RESULT_OK) + " }))", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Schnittstelle für die Weboberfläche (window.VLAndroid). */
    private class Bridge {
        @JavascriptInterface
        public void setPlaying(boolean isPlaying) {
            playing = isPlaying;
            ui.post(() -> {
                if (isPlaying) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** Öffnet die Google-Anmeldung (LoginActivity). */
        @JavascriptInterface
        public void googleLogin() {
            ui.post(() -> startActivityForResult(new Intent(MainActivity.this, LoginActivity.class), REQ_LOGIN));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            ui.post(() -> MainActivity.this.openExternal(Uri.parse(url)));
        }
    }
}
