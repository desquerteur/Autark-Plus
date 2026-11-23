// Owns: the website APK's own update (flavor site, Android 0.3.6): started by UpdateCheck on its own (owner 10.11.2026)
// or by "Update", it gets Android's "Install unknown apps" for
// Autark once (Settings, then back), streams the announced APK straight into an Android install session while it
// shows the real percent, checks size and SHA-256 against the release before it commits, and hands the install to
// Android, which asks the person to confirm (or, where Android allows it for an app updating itself, installs at once).
// The result comes back through UpdateReceiver. One update at a time; its last step survives a recreated activity.
// "Try again" runs the caller's own retry, which reads the release's feed anew – after a later release or in an upload
// window the remembered SHA-256 is stale, and repeating it would fail the same way; a failed download also makes
// UpdateCheck forget the remembered release.
// Never: installs a file whose bytes differ from the release, keeps the APK on disk, or exists in the Play build.
package com.teydralab.autark.android;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.teydralab.autark.android.relay.Json;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;

final class SelfUpdate {
    static final boolean BUILT = true;
    static final String ACTION_STATUS = "com.teydralab.autark.android.UPDATE_STATUS";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static volatile boolean running;
    private static volatile UpdateBar.Progress listener;
    private static Map<String, Object> waitingForPermission;
    private static Runnable again;
    private static Intent confirm;
    private static volatile String text;
    private static volatile int percent = -1;
    private static String action;
    private static Runnable onAction;

    private SelfUpdate() {}

    static boolean busy() { return running || confirm != null; }

    /** A new screen takes over the update's line and sees its last step at once. */
    static void attach(Activity activity, UpdateBar.Progress progress) {
        listener = progress;
        if (text != null) progress.step(text, percent, action, onAction);
    }

    /** "Update": the permission first, then the download in the background; `retry` reads the release's feed anew and
     * starts again ("Try again" after a failure). */
    static void start(Activity activity, Map<String, Object> release, UpdateBar.Progress progress, Runnable retry) {
        listener = progress;
        if (running) return;
        again = retry;
        String name = name(release);
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            waitingForPermission = release;
            step("Allow Autark to install updates (Install unknown apps), then come back", -1, "Settings", () -> openPermission(activity));
            openPermission(activity);
            return;
        }
        waitingForPermission = null;
        running = true;
        confirm = null;
        step("Downloading " + name + "…", 0, null, null);
        Context context = activity.getApplicationContext();
        new Thread(() -> download(context, release), "autark-self-update").start();
    }

    /** Back from Android's settings: with the permission granted, the update goes on by itself. */
    static void resumed(Activity activity, UpdateBar.Progress progress) {
        listener = progress;
        Map<String, Object> release = waitingForPermission;
        if (release != null && !running && (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls())) start(activity, release, progress, again);
        else if (confirm != null) step("Confirm the update in Android's dialog", -1, "Install", () -> showConfirm(activity));
    }

    private static void openPermission(Activity activity) {
        try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
        catch (ActivityNotFoundException error) {
            try { activity.startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (ActivityNotFoundException none) { /* the line still says what to allow */ }
        }
    }

    private static void download(Context context, Map<String, Object> release) {
        String name = name(release);
        long total = UpdateRelease.bytes(release);
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.Session session = null;
        HttpURLConnection connection = null;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            params.setSize(total);
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = installer.createSession(params);
            session = installer.openSession(id);
            connection = (HttpURLConnection) new URL(Json.str(release, "url")).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != 200) throw new IOException("the server answered " + connection.getResponseCode());
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long read = 0;
            int shown = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = session.openWrite("autark.apk", 0, total)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    if (read + n > total) throw new IOException("the file is larger than the release says");
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    read += n;
                    int now = UpdateRelease.percent(read, total);
                    if (now != shown) { shown = now; step("Downloading " + name + "… " + now + " %", now, null, null); }
                }
                session.fsync(out);
            }
            if (!UpdateRelease.verified(release, UpdateRelease.hex(digest.digest()), read)) throw new IOException("the download does not match the release (size or SHA-256)");
            // Where Android lets an app update itself without a dialog, it closes Autark for the swap; UpdateReceiver's
            // notification brings the person back. The line says so first.
            step(Build.VERSION.SDK_INT >= 31 ? "Installing " + name + " – Autark closes for a moment" : "Installing " + name + "…", 100, null, null);
            Intent status = new Intent(context, UpdateReceiver.class).setAction(ACTION_STATUS);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).getIntentSender());
            session.close();
            session = null;
        } catch (IOException | NoSuchAlgorithmException | RuntimeException error) {
            if (session != null) { try { session.abandon(); } catch (RuntimeException ignored) { /* already gone */ } }
            UpdateCheck.forget(context); // the remembered release may be stale: the next start and "Try again" read the feed anew
            failed("Update failed: " + (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Android needs the person's confirmation: its dialog opens now; the line keeps a button for it. */
    static void needsConfirmation(Context context, Intent dialog) {
        confirm = dialog;
        running = false;
        step("Confirm the update in Android's dialog", -1, "Install", () -> showConfirm(context));
        showConfirm(context);
    }

    private static void showConfirm(Context context) {
        Intent dialog = confirm;
        if (dialog == null) return;
        try { context.startActivity(new Intent(dialog).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (RuntimeException error) { failed("Android could not open its install dialog."); }
    }

    /** The update ended without this app being replaced (download failed, cancelled or refused). */
    static void failed(String message) {
        running = false;
        confirm = null;
        Runnable retry = again;
        step(message, -1, retry == null ? null : "Try again", retry);
    }

    private static void step(String value, int now, String label, Runnable run) {
        text = value; percent = now; action = label; onAction = run;
        MAIN.post(() -> { UpdateBar.Progress progress = listener; if (progress != null) progress.step(value, now, label, run); });
    }

    private static String name(Map<String, Object> release) {
        String version = Json.str(release, "versionName");
        return "Autark" + (version == null ? "" : " " + version);
    }
}
