package de.videolauncher.app;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Anmeldung mit Google: zeigt die offizielle Google-Anmeldeseite. Sobald YouTube
 * die Sitzung bestätigt hat, werden die youtube.com-Cookies an den eingebauten
 * Server übergeben (wie „Mit Browser-Cookies anmelden“, nur automatisch). Das
 * Passwort sieht die App nie – es wird ausschließlich auf der Google-Seite eingegeben.
 */
public class LoginActivity extends Activity {
    private static final String START_URL = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&hl=de"
            + "&continue=" + Uri.encode("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&hl=de&next=%2F");

    private WebView web;
    private ProgressBar progress;
    private boolean done = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#0f0f0f"));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.parseColor("#0f0f0f"));

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        TextView title = new TextView(this);
        title.setText(R.string.login_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button close = new Button(this);
        close.setText(R.string.cancel);
        close.setOnClickListener(v -> finish());
        bar.addView(close);
        box.addView(bar);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        box.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        web = new WebView(this);
        box.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(box);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        // Google lehnt Anmeldungen in eingebetteten WebViews ab, wenn sie sich als
        // solche ausgeben („; wv“, „Version/4.0“). Deshalb als normales Chrome melden.
        s.setUserAgentString(chromeUserAgent(s.getUserAgentString()));

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        // Frisch anfangen, damit kein altes/abgelaufenes Konto übernommen wird.
        cm.removeAllCookies(ok -> web.loadUrl(START_URL));

        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                // Nur Webseiten innerhalb des Anmeldefensters öffnen (keine App-Links/Intents).
                return !("https".equals(scheme) || "http".equals(scheme));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                checkSignedIn(url);
            }
        });
    }

    private void checkSignedIn(String url) {
        if (done || url == null) return;
        String host = Uri.parse(url).getHost();
        if (host == null || !(host.equals("youtube.com") || host.endsWith(".youtube.com"))) return;
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String cookie = cm.getCookie("https://www.youtube.com");
        if (cookie == null || !(cookie.contains("SAPISID=") || cookie.contains("__Secure-3PAPISID="))) return;
        done = true;
        progress.setIndeterminate(true);
        progress.setVisibility(View.VISIBLE);
        final String c = cookie;
        new Thread(() -> {
            String err = sendToServer(c);
            ui.post(() -> {
                if (err == null) {
                    Toast.makeText(this, R.string.login_ok, Toast.LENGTH_SHORT).show();
                    setResult(RESULT_OK);
                    finish();
                } else {
                    done = false;
                    progress.setIndeterminate(false);
                    Toast.makeText(this, getString(R.string.login_failed, err), Toast.LENGTH_LONG).show();
                }
            });
        }, "login-save").start();
    }

    /** Übergibt die Cookies an /api/auth/cookie des eingebauten Servers. */
    private static String sendToServer(String cookie) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(NodeBridge.BASE_URL + "/api/auth/cookie").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(5000);
            c.setReadTimeout(30000);
            c.setDoOutput(true);
            c.setRequestProperty("content-type", "application/json");
            c.setRequestProperty("x-vl", "1");
            byte[] body = ("{\"cookie\":" + jsonString(cookie) + ",\"source\":\"android\"}").getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body);
            }
            int code = c.getResponseCode();
            return code >= 200 && code < 300 ? null : "HTTP " + code;
        } catch (Exception e) {
            return e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static String jsonString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    static String chromeUserAgent(String ua) {
        if (ua == null) ua = "";
        ua = ua.replace("; wv)", ")").replaceAll("Version/\\d+(\\.\\d+)* ", "");
        if (!ua.contains("Chrome/")) {
            ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
        }
        return ua;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
