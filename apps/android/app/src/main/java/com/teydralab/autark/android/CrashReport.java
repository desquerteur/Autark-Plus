// Owns: the crash report that needs no PC (B-084 start crash): the process's handler for an uncaught exception writes the
// trace (time, version, device, Android) to filesDir/last-crash.txt and then lets Android end the app as before; on the
// next start MainActivity shows it first on one plain screen "Autark stopped last time" – the trace to select or copy,
// Report (16.11.2026: the app starts and hands the trace to the page, NativePort 'crash', which attaches it to a feedback
// report; the file goes once the page has it) and Continue, which deletes the file and starts the app.
// Never: sends the report anywhere without the person's Report, or keeps more than the last one.
package com.teydralab.autark.android;

import android.app.Activity;
import android.app.Application;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Build;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Date;

public final class CrashReport extends Application {
    private static final String FILE = "last-crash.txt";

    @Override public void onCreate() {
        super.onCreate();
        File file = new File(getFilesDir(), FILE);
        String version;
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception unknown) { version = "?"; }
        String head = "Autark " + version + "\nDevice: " + Build.MANUFACTURER + " " + Build.MODEL + "\nAndroid " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try (PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8))) {
                out.println(head + "\nTime: " + new Date() + "\nThread: " + thread.getName() + "\n");
                error.printStackTrace(out);
            } catch (Throwable ignored) { /* the report helps; it never becomes a second failure */ }
            if (previous != null) previous.uncaughtException(thread, error); else System.exit(10);
        });
    }

    /** The last crash's report, or null. */
    static String last(Context context) {
        File file = new File(context.getFilesDir(), FILE);
        if (!file.isFile()) return null;
        try { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); } catch (Exception unreadable) { file.delete(); return null; }
    }

    /** The report was handed to the page (or the person chose Continue): it goes. */
    static void clear(Context context) { new File(context.getFilesDir(), FILE).delete(); }

    /** The plain screen: the report to select or copy; Report runs `send` (the file stays until the page has it);
     *  Continue deletes it and runs `next`. */
    static void show(Activity activity, String report, Runnable next, Runnable send) {
        int pad = Math.round(16 * activity.getResources().getDisplayMetrics().density);
        TextView title = new TextView(activity);
        title.setText("Autark stopped last time"); title.setTextSize(20);
        TextView trace = new TextView(activity);
        trace.setText(report); trace.setTextIsSelectable(true); trace.setTypeface(Typeface.MONOSPACE); trace.setTextSize(12);
        ScrollView scroll = new ScrollView(activity); scroll.addView(trace);
        Button copy = new Button(activity); copy.setText("Copy");
        copy.setOnClickListener(view -> {
            ClipboardManager clipboard = activity.getSystemService(ClipboardManager.class);
            if (clipboard != null) { clipboard.setPrimaryClip(ClipData.newPlainText("Autark crash", report)); copy.setText("Copied"); }
        });
        Button hand = new Button(activity); hand.setText("Report"); hand.setOnClickListener(view -> send.run());
        Button go = new Button(activity); go.setText("Continue"); go.setOnClickListener(view -> { clear(activity); next.run(); });
        LinearLayout buttons = new LinearLayout(activity);
        buttons.addView(copy); buttons.addView(hand); buttons.addView(go);
        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL); page.setPadding(pad, pad, pad, pad);
        page.addView(title);
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        page.addView(buttons);
        FrameLayout frame = new FrameLayout(activity);
        frame.setFitsSystemWindows(true); // clear of the status and navigation bars (edge-to-edge on Android 15+)
        frame.addView(page, new FrameLayout.LayoutParams(-1, -1));
        activity.setContentView(frame);
    }
}
