// Owns: the small see-through pill at the screen's top edge while the AI uses the phone (an accessibility overlay: no
// extra permission, shown above every app). Four fixed cells – the Autark mark, one line, a button of fixed width and ✕ –
// in a pill of fixed width, so nothing in it moves when its line changes. Looks: active – "<agent> is using this phone"
// (or the AI's own short status line, phone.say) with Pause and ✕; paused by a touch – "Paused · goes on in a moment"
// with Pause (which holds) and ✕, back to active by itself when the service says so; paused by the person – "Paused ·
// the phone is yours" with Continue and ✕; the AI's question (phone.say ask) – its text with ✓ and ✕, answered once.
// Its window watches touches outside itself (FLAG_WATCH_OUTSIDE_TOUCH) without taking them: they reach the app as
// before, and the service hears that the person touched the screen. For the AI's screenshot it is invisible for one
// frame (hideForShot), and while the AI's own gesture runs touches pass through it (passThrough: FLAG_NOT_TOUCHABLE),
// so the AI neither sees nor presses it. It stays HIDE_AFTER_MS (the session, UseState.SESSION_MS) after the last step,
// so the touch watch lasts the whole session. Never: stays after ✕ (it closes at once), hides while paused, or treats the
// AI's text as anything but text.
package com.teydralab.autark.android.phoneuse;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.teydralab.autark.android.R;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class UseBubble {
    /** What the person did with the bubble or the screen (called on the main thread). */
    interface Person {
        void pause();
        void resume();
        void end();
        void touched();
    }

    private enum Look { ACTIVE, TOUCH, HELD }

    private static final long HIDE_AFTER_MS = UseState.SESSION_MS;
    /** After a frame was drawn, this long until it is on the screen (composited). */
    private static final long FRAME_MS = 32;
    /** The longest a step waits for the bubble to hide or let touches through. */
    private static final long WAIT_MS = 300;
    private final AccessibilityService service;
    private final WindowManager windows;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Person person;
    private final boolean german = "de".equals(Locale.getDefault().getLanguage());
    private final Runnable hide = this::remove;
    private LinearLayout view;
    private WindowManager.LayoutParams params;
    private TextView line;
    private TextView primary;
    private TextView close;
    private Look look = Look.ACTIVE;
    private Runnable quiet;
    private volatile String by;
    private volatile String job;
    private volatile String said;
    private String question;
    private Consumer<String> answer;
    private boolean shownBeforeQuestion;

    UseBubble(AccessibilityService service, Person person) {
        this.service = service;
        this.windows = (WindowManager) service.getSystemService(AccessibilityService.WINDOW_SERVICE);
        this.person = person;
    }

    /** Who acts and for which job (any thread): the agent's name for the line; a new job clears the AI's status line. */
    void who(String agent, String forJob) {
        String name = agent == null ? null : agent.replaceAll("\\s+", " ").trim();
        by = name == null || name.isEmpty() ? null : name.length() > 40 ? name.substring(0, 40) : name;
        if (forJob == null ? job != null : !forJob.equals(job)) said = null;
        job = forJob;
    }

    /** The AI's status line (phone.say without ask; any thread): shown while active, until the next one or a new job. */
    void said(String text) { said = text; main.post(this::render); }

    /** Active, visible; it goes HIDE_AFTER_MS after the last call. */
    void active() { main.post(() -> { show(Look.ACTIVE); main.removeCallbacks(hide); main.postDelayed(hide, HIDE_AFTER_MS); }); }

    /** Paused by a touch: `goOn` runs `inMs` from now (the quiet wait; a later call replaces it). */
    void touchPaused(long inMs, Runnable goOn) {
        main.post(() -> {
            show(Look.TOUCH);
            main.removeCallbacks(hide);
            if (quiet != null) main.removeCallbacks(quiet);
            quiet = goOn;
            main.postDelayed(goOn, Math.max(0, inMs));
        });
    }

    /** Paused by the person's Pause: stays until Continue, ✓ or ✕. */
    void held() { main.post(() -> { show(Look.HELD); main.removeCallbacks(hide); }); }

    void close() { main.post(() -> { main.removeCallbacks(hide); cancelQuiet(); remove(); }); }

    /** The AI's question with ✓ and ✕ (any thread): `then` hears "yes" or "no" once, on the main thread. */
    void ask(String text, Consumer<String> then) {
        main.post(() -> {
            shownBeforeQuestion = view != null;
            question = text;
            answer = then;
            ensure();
            main.removeCallbacks(hide);
            render();
        });
    }

    /** The question is over (answered, or no answer in time): back to the look before it – or gone when it came
     *  alone and was not answered with ✓ (`keep` false). */
    void askDone(boolean keep) {
        main.post(() -> {
            question = null;
            answer = null;
            if (!keep && !shownBeforeQuestion) { remove(); return; }
            render();
            if (look == Look.ACTIVE) { main.removeCallbacks(hide); main.postDelayed(hide, HIDE_AFTER_MS); }
        });
    }

    /** Invisible until showAfterShot (a step's thread, never the main one): returns once a frame without it reached the
     *  screen, at most WAIT_MS. */
    void hideForShot() {
        CountDownLatch hidden = new CountDownLatch(1);
        main.post(() -> {
            if (view == null) { hidden.countDown(); return; }
            view.setVisibility(View.INVISIBLE);
            afterFrame(hidden::countDown);
        });
        await(hidden);
    }

    void showAfterShot() { main.post(() -> { if (view != null) view.setVisibility(View.VISIBLE); }); }

    /** While the AI's own gesture runs, touches pass through the bubble (a step's thread; on: returns once applied). */
    void passThrough(boolean on) {
        CountDownLatch applied = new CountDownLatch(1);
        main.post(() -> {
            if (view == null || params == null) { applied.countDown(); return; }
            if (on) params.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            else params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            try { windows.updateViewLayout(view, params); } catch (RuntimeException gone) { /* removed meanwhile */ }
            afterFrame(applied::countDown);
        });
        if (on) await(applied);
    }

    private void afterFrame(Runnable then) {
        if (view == null) { then.run(); return; }
        view.postOnAnimation(() -> main.postDelayed(then, FRAME_MS));
    }

    private static void await(CountDownLatch latch) {
        try { latch.await(WAIT_MS, TimeUnit.MILLISECONDS); } catch (InterruptedException stop) { Thread.currentThread().interrupt(); }
    }

    private void show(Look next) {
        if (next != Look.TOUCH) cancelQuiet();
        look = next;
        ensure();
        render();
    }

    private void cancelQuiet() {
        if (quiet != null) main.removeCallbacks(quiet);
        quiet = null;
    }

    /** The cells' texts for the look (or the question, which comes first). */
    private void render() {
        if (view == null) return;
        if (question != null) {
            set(question, "✓", german ? "Ja" : "Yes", german ? "Gerade nicht" : "Not now");
            return;
        }
        String end = german ? "Beenden" : "End";
        switch (look) {
            case TOUCH: set(german ? "Pausiert · geht gleich weiter" : "Paused · goes on in a moment", "Pause", null, end); break;
            case HELD: set(german ? "Pausiert · das Handy gehört dir" : "Paused · the phone is yours", german ? "Weiter" : "Continue", null, end); break;
            default: {
                String who = by == null ? "Autark" : by;
                set(said != null ? said : german ? who + " bedient dieses Handy" : who + " is using this phone", "Pause", null, end);
            }
        }
    }

    private void set(String text, String button, String buttonSays, String closeSays) {
        line.setText(text);
        primary.setText(button);
        primary.setContentDescription(buttonSays);
        close.setContentDescription(closeSays);
    }

    private void tapPrimary() {
        if (question != null) { reply("yes"); return; } // a second tap before the question goes is no Pause
        if (look == Look.HELD) person.resume(); else person.pause();
    }

    private void tapClose() {
        if (question != null) { reply("no"); return; }
        person.end();
    }

    private void reply(String value) {
        Consumer<String> then = answer;
        answer = null;
        if (then != null) then.accept(value);
    }

    private void ensure() {
        if (view != null) return;
        float density = service.getResources().getDisplayMetrics().density;
        int dp4 = Math.round(4 * density);
        view = new LinearLayout(service);
        view.setOrientation(LinearLayout.HORIZONTAL);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setPadding(dp4 * 3, 0, dp4, 0);
        view.setAlpha(0.85f); // see-through: the app below stays readable
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(235, 32, 36, 34));
        background.setCornerRadius(20 * density);
        view.setBackground(background);
        ImageView mark = new ImageView(service);
        mark.setImageResource(R.drawable.ic_stat_autark);
        LinearLayout.LayoutParams markSize = new LinearLayout.LayoutParams(dp4 * 4, dp4 * 4);
        markSize.setMarginEnd(dp4 * 2);
        view.addView(mark, markSize);
        line = text(12, false);
        line.setSingleLine(true);
        line.setEllipsize(TextUtils.TruncateAt.END);
        view.addView(line, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        primary = text(12, true);
        primary.setGravity(Gravity.CENTER);
        primary.setPadding(0, dp4 * 2, 0, dp4 * 2);
        primary.setOnClickListener((tap) -> tapPrimary());
        view.addView(primary, new LinearLayout.LayoutParams(dp4 * 16, LinearLayout.LayoutParams.WRAP_CONTENT));
        close = text(13, true);
        close.setText("✕");
        close.setGravity(Gravity.CENTER);
        close.setPadding(0, dp4 * 2, 0, dp4 * 2);
        close.setOnClickListener((tap) -> tapClose());
        view.addView(close, new LinearLayout.LayoutParams(dp4 * 9, LinearLayout.LayoutParams.WRAP_CONTENT));
        // Touches outside the bubble arrive as ACTION_OUTSIDE (no position for other apps' windows) and go on to the app.
        view.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) person.touched();
            return false;
        });
        int width = Math.min(service.getResources().getDisplayMetrics().widthPixels - dp4 * 8, dp4 * 80); // ≤ 320 dp, 16 dp gutters
        params = new WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = Math.round(36 * density);
        try { windows.addView(view, params); } catch (RuntimeException error) { view = null; params = null; }
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
        params = null;
    }
}
