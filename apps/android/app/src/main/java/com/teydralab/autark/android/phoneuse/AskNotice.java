// Owns: the AI's phone question (phone.say ask) where the bubble alone would go unseen (KI-Runde 17.11.2026: two asks, no
// tap within 60 s either time) – it vibrates once, and while the screen is off or the Autark app is not in front it is
// also a notification on the channel "Phone questions" with ✓ and ✕, which answer it exactly as the bubble's buttons do
// (this receiver hands the tap to UseService.answerAsk). The notification goes when the question is over (answered
// anywhere, or no answer in time). Never: answers by itself, or stays after the question.
package com.teydralab.autark.android.phoneuse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.teydralab.autark.android.AppNotices;
import java.util.Locale;

public final class AskNotice extends BroadcastReceiver {
    private static final String CHANNEL = "phone-ask";
    private static final int ID = 4108;
    private static final String ANSWER = "answer";
    private static final long BUZZ_MS = 250;

    /** The question is asked: one vibration, and the notification when the bubble alone could go unseen. */
    static void show(Context context, String question) {
        buzz(context);
        PowerManager power = context.getSystemService(PowerManager.class);
        boolean screenOn = power == null || power.isInteractive();
        if (screenOn && AppNotices.onScreen()) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        boolean german = "de".equals(Locale.getDefault().getLanguage());
        NotificationChannel channel = new NotificationChannel(CHANNEL, german ? "Fragen am Handy" : "Phone questions", NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(false); // the one vibration is buzz()'s
        manager.createNotificationChannel(channel);
        Notification.Builder builder = AppNotices.branded(new Notification.Builder(context, CHANNEL));
        builder.setContentTitle(german ? "Autark fragt" : "Autark asks").setContentText(question)
                .setStyle(new Notification.BigTextStyle().bigText(question)).setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true).setShowWhen(true).setTimeoutAfter(UseService.ASK_MS)
                .addAction(new Notification.Action.Builder(null, german ? "✓ Ja" : "✓ Yes", answer(context, "yes")).build())
                .addAction(new Notification.Action.Builder(null, german ? "✕ Gerade nicht" : "✕ Not now", answer(context, "no")).build());
        try { manager.notify(ID, builder.build()); } catch (RuntimeException error) { /* notifications not allowed: the bubble and the vibration remain */ }
    }

    /** The question is over. */
    static void cancel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(ID);
    }

    @Override public void onReceive(Context context, Intent intent) {
        String value = intent.getStringExtra(ANSWER);
        UseService service = UseService.current();
        if (service != null && ("yes".equals(value) || "no".equals(value))) service.answerAsk(value);
        cancel(context);
    }

    private static PendingIntent answer(Context context, String value) {
        Intent intent = new Intent(context, AskNotice.class).putExtra(ANSWER, value);
        return PendingIntent.getBroadcast(context, "yes".equals(value) ? 1 : 2, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void buzz(Context context) {
        Vibrator vibrator = context.getSystemService(Vibrator.class);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try { vibrator.vibrate(VibrationEffect.createOneShot(BUZZ_MS, VibrationEffect.DEFAULT_AMPLITUDE)); } catch (RuntimeException error) { /* no vibration here */ }
    }
}
