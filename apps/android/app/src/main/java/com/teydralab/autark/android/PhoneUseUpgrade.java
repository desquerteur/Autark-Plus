// Owns: getting the phone-use build into the website build without phone use (B-084, decision 1; owner 10.11.2026: "die
// Vollversion … wenn man die haben muss … automatisch downloaden", no searching for the right file). When the AI asks
// for a phone step (at most every ten minutes): with Autark open and allowed to install, the phone-use build downloads
// at once; otherwise one notification "Let the AI use this phone", whose tap starts the same download in the app.
// It reads the full feed latest-android.json (never the lite one), takes its release when it is the phone-use build of at
// least this version with SHA-256 and size, and hands it to the app's own installer (SelfUpdate's install session, which
// checks size and SHA-256 before it commits and shows its steps in the update line) – not a browser or file-manager
// sideload. Once installed, phone use still waits for the disclosure and Android's Accessibility switch (EnablePrompt).
// In the Play build (SelfUpdate.BUILT false) and in the build with phone use it offers nothing.
// Never: turns phone use on (the disclosure and Android's switch stay the person's), or installs a file whose bytes
// differ from the release.
package com.teydralab.autark.android;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.teydralab.autark.android.phoneuse.UseConsent;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class PhoneUseUpgrade {
    /** The intent extra of the notification's tap; MainActivity then calls confirm(). */
    static final String EXTRA = "phoneUseUpgrade";
    private static final String CHANNEL = "phone-use";
    private static final int ID = 4108;
    private static final long AGAIN_MS = 10 * 60_000L;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static volatile long shownAt;

    private PhoneUseUpgrade() {}

    /** True when this install can add phone use through its own installer (the website build without it). */
    public static boolean offered(Context context) {
        return SelfUpdate.BUILT && !UseConsent.available(context);
    }

    /** The AI asked for a phone step (any thread): Autark open and allowed to install fetches the phone-use build at once;
     * otherwise the notification "Let the AI use this phone". */
    public static void prompt(Context context) {
        if (!offered(context)) return;
        long now = System.currentTimeMillis();
        if (now - shownAt < AGAIN_MS) return;
        shownAt = now;
        Context app = context.getApplicationContext();
        MAIN.post(() -> {
            MainActivity shown = MainActivity.shown();
            if (shown != null && !shown.isFinishing() && !shown.isDestroyed() && UpdateCheck.canInstall(shown)) start(shown, shown.updates()::step);
            else notifyPerson(app);
        });
    }

    private static void notifyPerson(Context app) {
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Phone use", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(app, MainActivity.class).putExtra(EXTRA, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(app, ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = "Your AI wants to work on this phone. Tap and Autark adds phone use by itself.";
        Notification notification = new Notification.Builder(app, CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Let the AI use this phone").setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(tap).setAutoCancel(true).build();
        try { manager.notify(ID, notification); } catch (RuntimeException error) { /* notifications not allowed */ }
    }

    /** True when this intent is the notification's tap. */
    static boolean wanted(Intent intent) {
        return intent != null && intent.getBooleanExtra(EXTRA, false);
    }

    /** The notification's tap, or the AI's ask with Autark open: fetches the phone-use build and installs it through
     * SelfUpdate – no extra dialog; what phone use reads is shown before it is switched on (UseDisclosure). */
    static void start(Activity activity, UpdateBar.Progress progress) {
        if (!offered(activity) || activity.isFinishing()) return;
        install(activity, progress);
    }

    private static void install(Activity activity, UpdateBar.Progress progress) {
        if (SelfUpdate.busy()) { SelfUpdate.attach(activity, progress); return; }
        progress.step("Looking for the phone-use version…", -1, null, null);
        long installed = UpdateCheck.installedCode(activity);
        String installer = UpdateCheck.installer(activity);
        new Thread(() -> {
            Map<String, Object> release = null;
            String why = "The phone-use version could not be loaded right now.";
            try {
                release = release(fetch(UpdateRelease.feed(false)), installed, installer);
                why = "The phone-use version of this Autark is not out yet.";
            } catch (IOException | RuntimeException error) { /* offline: `why` says so */ }
            Map<String, Object> found = release;
            String line = why;
            activity.runOnUiThread(() -> {
                if (activity.isFinishing()) return;
                if (found != null) SelfUpdate.start(activity, found, progress, PhoneUseUpgrade::again);
                else progress.step(line, -1, "Try again", () -> install(activity, progress));
            });
        }, "autark-phone-use-upgrade").start();
    }

    /** "Try again" after a failed install: the full feed is read anew, on the screen shown then. */
    private static void again() {
        MainActivity shown = MainActivity.shown();
        if (shown != null && !shown.isDestroyed()) install(shown, shown.updates()::step);
    }

    /** The full feed's release when it is the phone-use build of at least this version that the app installs itself. */
    private static Map<String, Object> release(String json, long installed, String installer) {
        Map<String, Object> release = UpdateRelease.newer(json, installed - 1, false);
        if (release == null || Boolean.FALSE.equals(release.get("accessibilityService"))) return null;
        boolean own = UpdateRelease.source(installer, SelfUpdate.BUILT) == UpdateRelease.Source.FEED;
        return own && UpdateRelease.route(release) == UpdateRelease.Route.DOWNLOAD ? release : null;
    }

    private static String fetch(String feed) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(feed).openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setInstanceFollowRedirects(true);
        try (InputStream in = connection.getInputStream()) {
            if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
                if (out.size() > 16 * 1024) throw new IOException("too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
    }
}
