// Owns: the small foreground service while this phone is paired (B-084, decision 8; type remoteMessaging) and its one
// notice (owner 15.11.2026: only what matters belongs in the shade): title "Autark" and one fixed line, the Autark mark,
// silent, not on the lock screen, on the low-importance channel "Background connection" (id "connection", so a person's
// choice for it stays); a tap opens the app. The connection's state shows in the app's own status line, never here. It
// holds no socket of its own – it only keeps the app's process alive with the screen off, so the connection
// (relay/PhoneConnection) and the background socket with its notifications (phoneuse/UseLink, AppNotices) go on.
// MainActivity starts it once paired (a plain start while on screen, which then goes foreground); while it runs, start()
// does nothing, so a notice the person swiped away (Android 13+) stays away. "Forget this phone" stops it.
// Never: connects, reads or sends anything, or posts its notice again while running.
package com.teydralab.autark.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public final class KeepAlive extends Service {
    private static final String CHANNEL = "connection";
    private static final int ID = 4121;
    private static final String LINE = "Keeps your messages coming while the app is closed";
    private static volatile boolean running;

    /** Starts the service (from the app on screen); nothing while it runs already. */
    public static void start(Context context) {
        if (running) return;
        Context app = context.getApplicationContext();
        // A plain start from the app on screen: a refused startForeground below then only ends the service. After
        // startForegroundService the same refusal would be a crash nothing can catch ("did not then call startForeground").
        try { app.startService(new Intent(app, KeepAlive.class)); }
        catch (RuntimeException refused) { /* started from the background: the next time the app is open starts it */ }
    }

    /** "Forget this phone": no connection is left to keep. */
    public static void stop(Context context) {
        Context app = context.getApplicationContext();
        app.stopService(new Intent(app, KeepAlive.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (running) return START_NOT_STICKY; // already in the foreground: its notice is not posted again
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(ID, notification(this));
            running = true;
        } catch (RuntimeException refused) {
            stopSelf();
        }
        // A killed process starts fresh from the launcher; the service then comes back with the connection.
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() { running = false; super.onDestroy(); }

    @Override public IBinder onBind(Intent intent) { return null; }

    private static Notification notification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Background connection", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Silent: a low-importance channel without sound or vibration, and the notice alerts at most once anyway.
        return AppNotices.branded(new Notification.Builder(context, CHANNEL))
                .setContentTitle("Autark").setContentText(LINE).setContentIntent(tap).setOngoing(true).setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_SECRET).setCategory(Notification.CATEGORY_SERVICE).setOnlyAlertOnce(true).build();
    }
}
