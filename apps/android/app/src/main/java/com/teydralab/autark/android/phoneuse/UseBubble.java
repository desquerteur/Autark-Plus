// Owns: the small bubble at the screen's top edge while the AI uses the phone (an accessibility overlay: no extra
// permission, shown above every app). It shows UseState: active – "Autark is using this phone" with Pause and ✕;
// paused – "Paused · the phone is yours" with Continue and ✕. Its window watches touches outside itself
// (FLAG_WATCH_OUTSIDE_TOUCH) without taking them: they reach the app as before, and the service hears that the person
// touched the screen (UseState tells the AI's own gestures apart). Never: stays after the work ended (it hides
// HIDE_AFTER_MS after the last step while active, and at once after ✕), or hides while paused.
package com.teydralab.autark.android.phoneuse;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Locale;

final class UseBubble {
    /** What the person did with the bubble or the screen (called on the main thread). */
    interface Person {
        void pause();
        void resume();
        void end();
        void touched();
    }

    private static final long HIDE_AFTER_MS = 60_000;
    private final AccessibilityService service;
    private final WindowManager windows;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Person person;
    private final boolean german = "de".equals(Locale.getDefault().getLanguage());
    private LinearLayout view;
    private TextView line;
    private TextView primary;
    private TextView close;
    private boolean paused;
    private final Runnable hide = this::remove;

    UseBubble(AccessibilityService service, Person person) {
        this.service = service;
        this.windows = (WindowManager) service.getSystemService(AccessibilityService.WINDOW_SERVICE);
        this.person = person;
    }

    /** A step runs or just ran: active, visible; it goes HIDE_AFTER_MS after the last step. */
    void active() {
        main.post(() -> {
            paused = false;
            ensure();
            if (view == null) return;
            line.setText(german ? "Autark bedient dieses Handy" : "Autark is using this phone");
            primary.setText(german ? "Pause" : "Pause");
            main.removeCallbacks(hide);
            main.postDelayed(hide, HIDE_AFTER_MS);
        });
    }

    /** The person has the phone: stays until Continue or ✕. */
    void paused() {
        main.post(() -> {
            paused = true;
            ensure();
            if (view == null) return;
            line.setText(german ? "Pausiert · das Handy gehört dir" : "Paused · the phone is yours");
            primary.setText(german ? "Weiter" : "Continue");
            main.removeCallbacks(hide);
        });
    }

    void close() { main.post(() -> { main.removeCallbacks(hide); remove(); }); }

    private void ensure() {
        if (view != null) return;
        float density = service.getResources().getDisplayMetrics().density;
        int pad = Math.round(10 * density);
        view = new LinearLayout(service);
        view.setOrientation(LinearLayout.HORIZONTAL);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setPadding(pad * 2, pad / 2, pad / 2, pad / 2);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(235, 32, 36, 34));
        background.setCornerRadius(24 * density);
        view.setBackground(background);
        line = text(14, false);
        view.addView(line);
        primary = text(14, true);
        primary.setPadding(pad * 2, pad, pad, pad);
        primary.setOnClickListener((tap) -> { if (paused) person.resume(); else person.pause(); });
        view.addView(primary);
        close = text(16, true);
        close.setText("✕");
        close.setContentDescription(german ? "Beenden" : "End");
        close.setPadding(pad, pad, pad * 2, pad);
        close.setOnClickListener((tap) -> person.end());
        view.addView(close);
        // Touches outside the bubble arrive as ACTION_OUTSIDE (no position for other apps' windows) and go on to the app.
        view.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) person.touched();
            return false;
        });
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = Math.round(36 * density);
        try { windows.addView(view, params); } catch (RuntimeException error) { view = null; }
    }

    private TextView text(int size, boolean bold) {
        TextView text = new TextView(service);
        text.setTextColor(Color.WHITE);
        text.setTextSize(size);
        if (bold) text.setTypeface(text.getTypeface(), android.graphics.Typeface.BOLD);
        return text;
    }

    private void remove() {
        if (view == null) return;
        try { windows.removeView(view); } catch (RuntimeException ignored) { /* already gone */ }
        view = null;
    }
}
