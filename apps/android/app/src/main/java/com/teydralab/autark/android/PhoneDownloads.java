// Owns: saving a file from the page into the phone's Downloads (B-084 decision 11) – the port's 'download' chunks
// (base64, in seq order, ≤ 25 MB) collected in a cache file, and the same-origin /files/<sha256> links the WebView hands
// its DownloadListener, fetched from the local entrance with the WebView's own cookie (the gate). The finished file goes
// to MediaStore Downloads (Android 10+, no permission) or the app's Downloads folder (8–9), then one short toast
// "Saved to Downloads: <name>" and the 'saved' answer to the page. Never: fetches another origin, keeps a copy in the
// cache, or asks for a storage permission.
package com.teydralab.autark.android;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class PhoneDownloads {
    /** The file is in Downloads under this name (main thread). */
    interface Saved { void saved(String name); }

    static final long LIMIT = 25L * 1024 * 1024;
    private static final String TAG = "AutarkDownloads";
    private static final ExecutorService DISK = Executors.newSingleThreadExecutor();
    private final Activity activity;
    private final Saved saved;
    private File part;
    private OutputStream out;
    private long size;
    private int seq;

    PhoneDownloads(Activity activity, Saved saved) {
        this.activity = activity;
        this.saved = saved;
    }

    /** One 'download' chunk from the port (main thread); seq 0 starts a file, last finishes it. */
    void chunk(String name, String mime, String data, boolean last, int at) {
        byte[] bytes;
        try { bytes = Base64.decode(data == null ? "" : data, Base64.DEFAULT); } catch (IllegalArgumentException error) { bytes = null; }
        byte[] chunk = bytes;
        DISK.execute(() -> {
            try {
                if (at == 0) { drop(); part = File.createTempFile("download", ".part", activity.getCacheDir()); out = new FileOutputStream(part); size = 0; seq = 0; }
                if (out == null || at != seq || chunk == null) throw new IOException("A part of the file was missing.");
                size += chunk.length;
                if (size > LIMIT) throw new IOException("The file is larger than 25 MB.");
                out.write(chunk);
                seq++;
                if (!last) return;
                out.close(); out = null;
                File done = part; part = null;
                finish(activity, done, name, mime, saved);
            } catch (IOException error) {
                drop();
                failed(activity, error);
            }
        });
    }

    /** A same-origin /files/ link from the WebView's DownloadListener: fetched with the WebView's cookie. False when it is not one. */
    static boolean fetch(Activity activity, String origin, String url, String disposition, String mime, Saved saved) {
        Uri uri = Uri.parse(url);
        if (origin == null || !ConnectionAddress.sameOrigin(origin, url) || uri.getPath() == null || !uri.getPath().matches("/files/[0-9a-f]{64}")) return false;
        String name = URLUtil.guessFileName(url, disposition, mime);
        String cookie = CookieManager.getInstance().getCookie(url);
        DISK.execute(() -> {
            File part = null;
            try {
                HttpURLConnection http = (HttpURLConnection) new URL(url).openConnection();
                http.setConnectTimeout(15_000); http.setReadTimeout(30_000);
                if (cookie != null) http.setRequestProperty("Cookie", cookie);
                if (http.getResponseCode() != 200) throw new IOException("The PC answered HTTP " + http.getResponseCode() + ".");
                if (http.getContentLengthLong() > LIMIT) throw new IOException("The file is larger than 25 MB.");
                part = File.createTempFile("download", ".part", activity.getCacheDir());
                try (InputStream in = http.getInputStream(); OutputStream file = new FileOutputStream(part)) { copy(in, file, LIMIT); }
                finally { http.disconnect(); }
                finish(activity, part, name, mime == null || mime.isEmpty() ? http.getContentType() : mime, saved);
            } catch (IOException error) {
                if (part != null && !part.delete()) Log.w(TAG, "cache file left");
                failed(activity, error);
            }
        });
        return true;
    }

    /** Ends a half-received file (page reloaded, port closed). */
    void cancel() { DISK.execute(this::drop); }

    private void drop() {
        try { if (out != null) out.close(); } catch (IOException ignored) { /* the cache file goes anyway */ }
        out = null;
        if (part != null && !part.delete()) Log.w(TAG, "cache file left");
        part = null;
    }

    /** Disk thread: moves the cache file into Downloads, then the toast and the page's answer. */
    private static void finish(Activity activity, File done, String name, String mime, Saved saved) throws IOException {
        String clean = clean(name);
        String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
        try (InputStream in = new FileInputStream(done)) {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, clean);
                values.put(MediaStore.Downloads.MIME_TYPE, type);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri target = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (target == null) throw new IOException("Downloads is not available.");
                try (OutputStream file = activity.getContentResolver().openOutputStream(target)) {
                    if (file == null) throw new IOException("Downloads is not available.");
                    copy(in, file, LIMIT);
                } catch (IOException error) { activity.getContentResolver().delete(target, null, null); throw error; }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                activity.getContentResolver().update(target, values, null, null);
            } else {
                File folder = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (folder == null || !(folder.isDirectory() || folder.mkdirs())) throw new IOException("Downloads is not available.");
                File target = new File(folder, clean);
                for (int n = 1; target.exists(); n++) target = new File(folder, n + "-" + clean);
                try (OutputStream file = new FileOutputStream(target)) { copy(in, file, LIMIT); }
                clean = target.getName();
            }
        } finally {
            if (!done.delete()) Log.w(TAG, "cache file left");
        }
        String shown = clean;
        Log.i(TAG, "saved " + shown);
        activity.runOnUiThread(() -> {
            Toast.makeText(activity, "Saved to Downloads: " + shown, Toast.LENGTH_SHORT).show();
            saved.saved(shown);
        });
    }

    private static void failed(Activity activity, IOException error) {
        Log.w(TAG, "download failed", error);
        String reason = error.getMessage() == null ? "" : " " + error.getMessage();
        activity.runOnUiThread(() -> Toast.makeText(activity, "The file was not saved." + reason, Toast.LENGTH_SHORT).show());
    }

    private static void copy(InputStream in, OutputStream out, long limit) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        for (int read; (read = in.read(buffer)) > 0; ) {
            total += read;
            if (total > limit) throw new IOException("The file is larger than 25 MB.");
            out.write(buffer, 0, read);
        }
    }

    /** A plain file name: no folders, no control characters, at most 120 characters. */
    static String clean(String name) {
        String base = name == null ? "" : name.replaceAll(".*[/\\\\]", "").replaceAll("[\\p{Cntrl}:*?\"<>|]", "_").trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) base = "download";
        return base.length() > 120 ? base.substring(base.length() - 120) : base;
    }
}
