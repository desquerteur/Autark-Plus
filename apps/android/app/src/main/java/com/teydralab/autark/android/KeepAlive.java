// Owns: the small foreground service while this phone is paired (B-084, decision 8; type remoteMessaging): its one quiet
// ongoing notification on the low-importance channel "Connection" says "Connected to <PC>" or "Reconnecting…" and opens
// the app on a tap. It holds no socket of its own – it only keeps the app's process alive with the screen off, so the
// connection (relay/PhoneConnection) and the background socket with its notifications (phoneuse/UseLink, AppNotices)
// go on. MainActivity starts it once paired (a plain start while on screen, which then goes foreground), updates
// its line from the connection's status and stops it on "Forget this phone". Never: connects, reads or sends anything.
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
    private static volatile String line = "Connecting…";
    private static volatile boolean running;

    /** Starts the service (from the app on screen) with its first line. */
    public static void start(Context context, String text) {
        if (text != null) line = text;
        Context app = context.getApplicationContext();
        // A plain start from the app on screen: a refused startForeground below then only ends the service. After
        // startForegroundService the same refusal would be a crash nothing can catch ("did not then call startForeground").
        try { app.startService(new Intent(app, KeepAlive.class)); }
        catch (RuntimeException refused) { /* started from the background: the next time the app is open starts it */ }
    }

    /** The connection's state changed: the notification shows the new line. */
    public static void update(Context context, String text) {
        if (text == null || text.equals(line)) return;
        line = text;
        if (!running) return;
        Context app = context.getApplicationContext();
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        if (manager != null) {
            try { manager.notify(ID, notification(app)); } catch (RuntimeException error) { /* notifications not allowed */ }
        }
    }

    /** "Forget this phone": no connection is left to keep. */
    public static void stop(Context context) {
        Context app = context.getApplicationContext();
        app.stopService(new Intent(app, KeepAlive.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
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
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Connection", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle(line).setContentIntent(tap).setOngoing(true).setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE).setOnlyAlertOnce(true).build();
    }
}
