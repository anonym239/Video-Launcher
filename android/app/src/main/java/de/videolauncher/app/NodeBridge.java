package de.videolauncher.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.system.Os;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Startet den eingebauten Node.js-Server. Läuft im eigenen Prozess ":node" (siehe
 * NodeService), damit ein Fehler in Node nicht die ganze App beendet.
 */
public final class NodeBridge {
    private static final String TAG = "VideoLauncher";
    public static final int PORT = 8723;
    public static final String BASE_URL = "http://127.0.0.1:" + PORT;

    private static volatile boolean started = false;

    private NodeBridge() {}

    public static native int startNodeWithArguments(String[] arguments);

    static File logFile(Context ctx) {
        return new File(ctx.getFilesDir(), "node.log");
    }

    static File errorFile(Context ctx) {
        return new File(ctx.getFilesDir(), "node-error.txt");
    }

    /** Fehlermeldung des Node-Prozesses (über eine Datei, da anderer Prozess). */
    public static String getStartError(Context ctx) {
        File f = errorFile(ctx);
        if (!f.exists()) return null;
        try {
            String s = readFile(f).trim();
            return s.isEmpty() ? null : s;
        } catch (IOException e) {
            return null;
        }
    }

    /** Letzte Zeilen des Node-Logs (für die Fehleranzeige). */
    public static String getLogTail(Context ctx, int maxChars) {
        File f = logFile(ctx);
        if (!f.exists()) return "";
        try {
            String s = readFile(f);
            return s.length() > maxChars ? s.substring(s.length() - maxChars) : s;
        } catch (IOException e) {
            return "";
        }
    }

    private static void writeError(Context ctx, String msg) {
        try (OutputStream os = new FileOutputStream(errorFile(ctx))) {
            os.write(msg.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    public static synchronized void start(Context ctx) {
        if (started) return;
        started = true;
        final Context app = ctx.getApplicationContext();
        //noinspection ResultOfMethodCallIgnored
        errorFile(app).delete();
        // Eigener Thread mit großem Stack (der Parser für den YouTube-Player arbeitet rekursiv).
        Thread t = new Thread(null, () -> {
            try {
                System.loadLibrary("node");
                System.loadLibrary("native-lib");
                File project = prepareProject(app);
                File data = new File(app.getFilesDir(), "data");
                //noinspection ResultOfMethodCallIgnored
                data.mkdirs();
                File log = logFile(app);
                if (log.length() > 512 * 1024) //noinspection ResultOfMethodCallIgnored
                    log.delete();
                Os.setenv("VL_DATA_DIR", data.getAbsolutePath(), true);
                Os.setenv("VL_LOG_FILE", log.getAbsolutePath(), true);
                Os.setenv("PORT", String.valueOf(PORT), true);
                Os.setenv("TMPDIR", app.getCacheDir().getAbsolutePath(), true);
                Os.setenv("HOME", app.getFilesDir().getAbsolutePath(), true);
                Os.setenv("VL_PLATFORM", "android", true);
                // Node.js für Android hat kein Intl → Zeitzone von Android übernehmen.
                Os.setenv("TZ", java.util.TimeZone.getDefault().getID(), true);
                int code = startNodeWithArguments(new String[]{
                        "node",
                        "--max-old-space-size=256",
                        new File(project, "server/index.js").getAbsolutePath()
                });
                writeError(app, "Node.js wurde beendet (Code " + code + ")");
                Log.e(TAG, "Node.js beendet: " + code);
            } catch (Throwable e) {
                writeError(app, e.toString());
                Log.e(TAG, "Start fehlgeschlagen", e);
            }
        }, "node-main", 32L * 1024 * 1024);
        t.setDaemon(true);
        t.start();
    }

    /** Entpackt nodejs-project.zip aus den Assets, wenn sich die App-Version geändert hat. */
    private static File prepareProject(Context ctx) throws IOException {
        File dir = new File(ctx.getFilesDir(), "nodejs-project");
        File marker = new File(dir, ".version");
        String version = readAsset(ctx.getAssets(), "nodejs-project.version").trim();
        if (marker.exists() && version.equals(readFile(marker).trim())) return dir;

        deleteRecursive(dir);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        String root = dir.getCanonicalPath() + File.separator;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream zip = new ZipInputStream(ctx.getAssets().open("nodejs-project.zip"))) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                File out = new File(dir, e.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Ungültiger Pfad im Archiv");
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                    continue;
                }
                //noinspection ResultOfMethodCallIgnored
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
        try (OutputStream os = new FileOutputStream(marker)) {
            os.write(version.getBytes(StandardCharsets.UTF_8));
        }
        return dir;
    }

    /** Prüft, ob der Server antwortet. */
    public static boolean isReady() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(BASE_URL + "/api/status").openConnection();
            c.setConnectTimeout(500);
            c.setReadTimeout(1500);
            return c.getResponseCode() == 200;
        } catch (IOException e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAsset(AssetManager am, String name) throws IOException {
        try (InputStream in = am.open(name)) {
            return readStream(in);
        }
    }

    static String readFile(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            return readStream(in);
        }
    }

    private static String readStream(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    private static void deleteRecursive(File f) {
        if (!f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
