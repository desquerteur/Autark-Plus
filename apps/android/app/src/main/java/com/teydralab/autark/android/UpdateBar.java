// Owns: the one native line above the PC's UI that says an update is there and carries it out: text, one button, a
// close mark and a thin progress line with the real download percent. A fixed cell: it appears once when an update is
// found; while it shows, a step only changes its text, the button's label and the progress – nothing moves.
// Never: decides about updates (UpdateCheck), downloads (SelfUpdate) or covers the web UI.
package com.teydralab.autark.android;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

final class UpdateBar {
    /** One step of an update as the bar shows it; SelfUpdate reports through this on the main thread. */
    interface Progress {
        /** percent: 0–100 shows the progress line, -1 hides it; action null hides the button (its cell stays). */
        void step(String text, int percent, String action, Runnable onAction);
    }

    final LinearLayout view;
    private final TextView line;
    private final Button button;
    private final ProgressBar progress;
    private Runnable onAction;
    private boolean closed;

    UpdateBar(Activity activity) {
        float density = activity.getResources().getDisplayMetrics().density;
        boolean dark = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int background = dark ? Color.rgb(0x1E, 0x2A, 0x27) : Color.rgb(0xE6, 0xF0, 0xED);
        int foreground = dark ? Color.rgb(0xEE, 0xF4, 0xF2) : Color.rgb(0x10, 0x22, 0x1E);
        view = new LinearLayout(activity);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setBackgroundColor(background);
        view.setVisibility(View.GONE);
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(px(density, 16), 0, px(density, 4), 0);
        line = new TextView(activity);
        line.setTextColor(foreground);
        line.setTextSize(14);
        line.setMaxLines(2);
        row.addView(line, new LinearLayout.LayoutParams(0, -2, 1));
        button = new Button(activity, null, android.R.attr.borderlessButtonStyle);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setTextColor(dark ? Color.rgb(0x8F, 0xD3, 0xC2) : Color.rgb(0x2C, 0x66, 0x5A));
        button.setMinWidth(px(density, 96));
        button.setOnClickListener((clicked) -> { if (onAction != null) onAction.run(); });
        row.addView(button, new LinearLayout.LayoutParams(-2, -2));
        TextView close = new TextView(activity);
        close.setText("×");
        close.setTextSize(22);
        close.setTextColor(foreground);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Hide until the next start");
        close.setOnClickListener((clicked) -> { closed = true; view.setVisibility(View.GONE); });
        row.addView(close, new LinearLayout.LayoutParams(px(density, 44), px(density, 48)));
        view.addView(row, new LinearLayout.LayoutParams(-1, px(density, 52)));
        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.INVISIBLE);
        view.addView(progress, new LinearLayout.LayoutParams(-1, px(density, 4)));
    }

    /** Shows a step (main thread). An update the person hid stays hidden until the next start, unless it is running. */
    void step(String text, int percent, String action, Runnable onAction) {
        boolean running = percent >= 0 || action == null;
        if (closed && !running) return;
        if (running) closed = false;
        line.setText(text);
        this.onAction = onAction;
        button.setText(action == null ? "" : action);
        button.setVisibility(action == null ? View.INVISIBLE : View.VISIBLE);
        progress.setVisibility(percent >= 0 ? View.VISIBLE : View.INVISIBLE);
        if (percent >= 0) progress.setProgress(percent);
        view.setVisibility(View.VISIBLE);
    }

    boolean shown() { return view.getVisibility() == View.VISIBLE; }

    private static int px(float density, int dp) { return Math.round(dp * density); }
}
