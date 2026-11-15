// Owns: Android's answers to the website APK's own update (flavor site): the install session's status (confirm dialog,
// cancelled, refused) goes to SelfUpdate's line; once the new version replaced this one (MY_PACKAGE_REPLACED – Android
// closes the old app for that), one notification "Autark <version> is installed · Tap to open" brings the person back.
// Never: starts an install of its own or shows anything for another app's update.
package com.teydralab.autark.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

public final class UpdateReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "updates";

    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) { installed(context); return; }
        if (!SelfUpdate.ACTION_STATUS.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent dialog = dialogOf(intent);
            if (dialog != null) SelfUpdate.needsConfirmation(context, dialog);
            else SelfUpdate.failed("Android did not show its install dialog.");
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            SelfUpdate.failed("Update cancelled.");
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            SelfUpdate.failed("Android did not install the update" + (message == null || message.isEmpty() ? " (status " + status + ")." : ": " + message));
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent dialogOf(Intent intent) {
        return Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private static void installed(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        String version;
        try { version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException error) { version = null; }
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT));
            builder = new Notification.Builder(context, CHANNEL);
        } else {
            builder = legacyBuilder(context);
        }
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(7, builder.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Autark" + (version == null ? "" : " " + version) + " is installed")
                .setContentText("Tap to open.").setContentIntent(tap).setAutoCancel(true).build());
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder legacyBuilder(Context context) { return new Notification.Builder(context); }
}
