// Owns: the one notification that asks the person to turn phone use on – "Let the AI use this phone": one tap opens the
// in-app disclosure (UseDisclosure) first and, once the person agreed, Android's Accessibility settings (Autark › Use this
// phone). A sideloaded app on Android 13+ first needs Settings › Apps › Autark › ⋮ › Allow restricted settings – the notification says so
// and has App info as its second button (not for an install from Google Play). At most once in 10 minutes; not at all in the
// build without phone use. Never: turns anything on itself, or sends the person to the settings before the disclosure.
package com.teydralab.autark.android.phoneuse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.teydralab.autark.android.AppNotices;

public final class EnablePrompt {
    private static final String CHANNEL = "phone-use";
    private static final int ID = 4107;
    private static final long AGAIN_MS = 10 * 60_000;
    private static volatile long shownAt;

    private EnablePrompt() {}

    /** The text of the prompt (also shown in the app when it is open). */
    public static String text() {
        return Build.VERSION.SDK_INT >= 33
                ? "Tap to read what this does, then Accessibility › Use this phone. Greyed out or \"restricted setting\"? First Settings › Apps › Autark › ⋮ › Allow restricted settings (names can differ by phone maker)."
                : "Tap to read what this does, then Autark › Use this phone.";
    }

    public static void show(Context context) {
        if (!UseConsent.available(context)) return;
        long now = System.currentTimeMillis();
        if (now - shownAt < AGAIN_MS) return;
        shownAt = now;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Phone use", NotificationManager.IMPORTANCE_DEFAULT));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // The disclosure comes first; once agreed it passes on to the settings itself.
        PendingIntent settings = PendingIntent.getActivity(context, 1, new Intent(context, UseDisclosure.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags);
        PendingIntent appInfo = PendingIntent.getActivity(context, 2, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        AppNotices.branded(builder).setContentTitle("Let the AI use this phone").setContentText(text())
                .setStyle(new Notification.BigTextStyle().bigText(text())).setContentIntent(settings).setAutoCancel(true)
                .addAction(new Notification.Action.Builder(null, "App info", appInfo).build());
        try { manager.notify(ID, builder.build()); } catch (SecurityException error) { /* notifications not allowed: the app shows the text when open */ }
    }
}
