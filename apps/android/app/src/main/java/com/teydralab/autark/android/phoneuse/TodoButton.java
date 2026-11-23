// Owns: the person's small to-do button over every app (an accessibility overlay of UseService: no extra permission),
// shown while this phone is paired (UseLink.linked()), also while the Autark app is closed. Three looks in one window:
// the dot (40 dp, the Autark mark, see-through; a drag beyond the touch slop moves it, a tap opens the panel, a drop
// with the finger at a side edge – or an accessibility long-click – turns it into the tab), the tab (10 × 36 dp at the nearest side edge; a
// tap brings the dot back) and the panel beside the dot – icons only: screenshot, dictate, call, send, close (back to
// the dot) –, one text field (1 line, up to 4), a strip of the shots taken (a tap removes one; at most TodoPost.MAX) and
// one short status line. Opening the panel takes a screenshot at once; the camera takes one more after the person went
// somewhere else (UseService.capture – the bubble and this button are hidden for that frame). Dictation is Android's
// SpeechRecognizer with its partial words in the field; without the microphone right the mic opens the app instead.
// Send: every shot goes up (files.upload), then tasks.quickCreate with the text, the shots and the post's client id
// (TodoPost) – Autark picks the owner; ✓, then empty and back to the dot. Call: the same, then the 1:1 with the agent who
// took it (chats.direct) opens in the app with #/chat/<id>?call=1 (the page starts the call), or the task
// (#/tasks?task=<id>) when no agent took it. A failure keeps everything and says one line; Send again reuses the client
// id. Holding the dot (HOLD_MS without moving) is a quick task without opening anything: the screenshot at once, the
// dot's red ring while it listens (SpeechRecognizer), and on release the words and that one shot go out as above; the
// dot shows ✓. Nothing heard, no microphone right or a failed post: the panel opens with the shot, the words and one
// line (a failed post keeps its client id). Where the dot sits and on which side the tab is stays in SharedPreferences "todo_button".
// The window takes key focus (the keyboard) only while the panel is open and the person is in the field; a touch
// outside gives the focus back to the app below. Collapsed, every touch outside the dot or tab reaches the app.
// Never: keeps the person's text or shots anywhere but this panel and the RPC, or shows in the AI's screenshot.
package com.teydralab.autark.android.phoneuse;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.InputType;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.teydralab.autark.android.MainActivity;
import com.teydralab.autark.android.PhoneRoutes;
import com.teydralab.autark.android.R;
import com.teydralab.autark.android.relay.Json;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class TodoButton {
    private enum Look { DOT, TAB, PANEL }

    private static final int DOT_DP = 40;
    private static final int TAB_W_DP = 10;
    private static final int TAB_H_DP = 36;
    private static final int PANEL_DP = 236;
    private static final int ICON_DP = 36;
    private static final int THUMB_DP = 34;
    /** A drop with the finger this close to a side edge makes the tab. */
    private static final int EDGE_DP = 14;
    private static final long FRAME_MS = 32;
    private static final long WAIT_MS = 300;
    /** How long one upload or call may take before the panel says it failed. */
    private static final long CALL_MS = 60_000;
    private static final long DONE_MS = 900;
    private static final int BG = Color.argb(235, 32, 36, 34);
    /** A press this long without moving is the quick task (owner 18.11.2026: ~350 ms). */
    private static final long HOLD_MS = 350;
    private static final int RED = Color.rgb(229, 57, 53);

    private final UseService service;
    private final WindowManager windows;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SharedPreferences place;
    private final float density;
    private final boolean german = "de".equals(Locale.getDefault().getLanguage());
    private final TodoPost post = new TodoPost();
    private final ExecutorService work = Executors.newSingleThreadExecutor((job) -> {
        Thread thread = new Thread(job, "autark-todo");
        thread.setDaemon(true);
        return thread;
    });
    private final Runnable onLink = () -> main.post(this::sync);
    private final List<ImageView> buttons = new ArrayList<>();

    private FrameLayout root;
    private WindowManager.LayoutParams params;
    private Look look = Look.DOT;
    private View dot;
    private View tab;
    private LinearLayout panel;
    private EditText field;
    private LinearLayout strip;
    private TextView line;
    private ImageView mic;
    private SpeechRecognizer speech;
    private String spokenBefore = "";
    private GradientDrawable dotRound;
    private ImageView dotMark;
    private TextView dotCheck;
    /** The quick task of a hold: its own post (one shot, its client id), the listener, the words so far. */
    private final TodoPost quick = new TodoPost();
    private SpeechRecognizer holdSpeech;
    private boolean holding;
    private boolean released;
    /** Counts holds, so a late timer of an earlier hold never ends a newer one. */
    private int holdRound;
    private String holdWords = "";
    /** The hold's shot (JPEG and thumbnail), written by the worker before any later job of the worker reads it. */
    private volatile byte[] holdJpeg;
    private volatile Bitmap holdThumb;
    private boolean busy;
    /** The text while the window is gone (the link paused); never stored anywhere else. */
    private String draft = "";
    private boolean closed;
    /** The panel's y before the keyboard moved it up (-1: not moved). */
    private int yBeforeKeyboard = -1;

    TodoButton(UseService service) {
        this.service = service;
        this.windows = (WindowManager) service.getSystemService(AccessibilityService.WINDOW_SERVICE);
        this.place = service.getSharedPreferences("todo_button", Context.MODE_PRIVATE);
        this.density = service.getResources().getDisplayMetrics().density;
    }

    /** Shows while this phone is paired, from now on (the main thread). */
    void start() {
        UseLink.onLinked(onLink);
        sync();
    }

    /** The service went off: the button goes for good (any thread). */
    void close() {
        UseLink.onLinked(null);
        work.shutdownNow();
        main.post(() -> { closed = true; stopSpeech(); endHoldSpeech(); holding = false; remove(); });
    }

    // ------------------------------------------------------------------ screenshot frame (a worker thread)

    /** Invisible until showAfterShot: returns once a frame without it reached the screen, at most WAIT_MS. */
    void hideForShot() {
        CountDownLatch hidden = new CountDownLatch(1);
        main.post(() -> {
            if (root == null) { hidden.countDown(); return; }
            root.setVisibility(View.INVISIBLE);
            root.postOnAnimation(() -> main.postDelayed(hidden::countDown, FRAME_MS));
        });
        try { hidden.await(WAIT_MS, TimeUnit.MILLISECONDS); } catch (InterruptedException stop) { Thread.currentThread().interrupt(); }
    }

    void showAfterShot() { main.post(() -> { if (root != null) root.setVisibility(View.VISIBLE); }); }

    // ------------------------------------------------------------------ window

    private void sync() {
        if (closed) return;
        if (UseLink.linked() != null) ensure(); else { stopSpeech(); remove(); }
    }

    private int dp(int value) { return Math.round(value * density); }

    private int[] screen() {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Rect bounds = windows.getCurrentWindowMetrics().getBounds();
            return new int[] { bounds.width(), bounds.height() };
        }
        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
        return new int[] { metrics.widthPixels, metrics.heightPixels };
    }

    private void ensure() {
        if (root != null) return;
        root = new FrameLayout(service) {
            @Override public boolean dispatchKeyEvent(KeyEvent event) {
                if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && look == Look.PANEL) {
                    if (event.getAction() == KeyEvent.ACTION_UP) collapse();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }
        };
        root.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) releaseFocus(); // the person went on in the app below
            return false;
        });
        dot = makeDot();
        tab = makeTab();
        panel = makePanel();
        root.addView(dot, new FrameLayout.LayoutParams(dp(DOT_DP), dp(DOT_DP)));
        root.addView(tab, new FrameLayout.LayoutParams(dp(TAB_W_DP), dp(TAB_H_DP)));
        root.addView(panel, new FrameLayout.LayoutParams(dp(PANEL_DP), FrameLayout.LayoutParams.WRAP_CONTENT));
        params = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING;
        boolean asTab = place.getBoolean("tab", false);
        int[] screen = screen();
        params.x = TodoPlace.clamp(place.getInt("x", screen[0] - dp(DOT_DP) - dp(8)), dp(DOT_DP), screen[0]);
        params.y = TodoPlace.clamp(place.getInt("y", screen[1] / 3), dp(DOT_DP), screen[1]);
        try { windows.addView(root, params); } catch (RuntimeException error) { root = null; params = null; return; }
        show(asTab ? Look.TAB : Look.DOT);
    }

    private void remove() {
        if (root == null) return;
        draft = field == null ? "" : field.getText().toString(); // a pause of the link keeps what the person typed
        try { windows.removeView(root); } catch (RuntimeException ignored) { /* already gone */ }
        root = null;
        params = null;
        look = Look.DOT;
    }

    private void update() {
        if (root == null) return;
        try { windows.updateViewLayout(root, params); } catch (RuntimeException gone) { /* removed meanwhile */ }
    }

    /** One look at a time; the window takes key focus only in the panel (focusable() below). */
    private void show(Look next) {
        if (root == null) return;
        look = next;
        dot.setVisibility(next == Look.DOT ? View.VISIBLE : View.GONE);
        tab.setVisibility(next == Look.TAB ? View.VISIBLE : View.GONE);
        panel.setVisibility(next == Look.PANEL ? View.VISIBLE : View.GONE);
        int[] screen = screen();
        if (next == Look.TAB) {
            boolean left = place.getBoolean("left", false);
            params.x = TodoPlace.sideX(left, dp(TAB_W_DP), screen[0]);
            params.y = TodoPlace.clamp(place.getInt("y", screen[1] / 3), dp(TAB_H_DP), screen[1]);
        } else if (next == Look.DOT) {
            params.x = TodoPlace.clamp(place.getInt("x", screen[0] - dp(DOT_DP + 8)), dp(DOT_DP), screen[0]);
            params.y = TodoPlace.clamp(place.getInt("y", screen[1] / 3), dp(DOT_DP), screen[1]);
        } else {
            int[] at = TodoPlace.panel(params.x, params.y, dp(DOT_DP), dp(PANEL_DP), panelHeight(), screen[0], screen[1]);
            params.x = at[0];
            params.y = at[1];
        }
        yBeforeKeyboard = -1;
        if (next != Look.PANEL) focusable(false);
        update();
    }

    private int panelHeight() {
        panel.measure(View.MeasureSpec.makeMeasureSpec(dp(PANEL_DP), View.MeasureSpec.EXACTLY), View.MeasureSpec.UNSPECIFIED);
        return panel.getMeasuredHeight();
    }

    /** Key focus for the field (on: the keyboard can open), or back to the app below. */
    private void focusable(boolean on) {
        if (params == null) return;
        boolean now = (params.flags & WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) == 0;
        if (now == on) return;
        if (on) params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        else params.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        if (!on && field != null) {
            field.clearFocus();
            InputMethodManager keyboard = (InputMethodManager) service.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(field.getWindowToken(), 0);
            if (yBeforeKeyboard >= 0) { params.y = yBeforeKeyboard; yBeforeKeyboard = -1; }
        }
        update();
    }

    private void releaseFocus() { if (look == Look.PANEL) focusable(false); }

    /** The person tapped into the field: the window takes the focus, the panel moves above the keyboard, the keyboard opens. */
    private void typeHere() {
        if (look != Look.PANEL || params == null) return;
        int y = TodoPlace.aboveKeyboard(params.y, panel.getHeight(), screen()[1]);
        if (y != params.y) { if (yBeforeKeyboard < 0) yBeforeKeyboard = params.y; params.y = y; }
        focusable(true);
        update();
        main.post(() -> {
            if (field == null) return;
            field.requestFocus();
            InputMethodManager keyboard = (InputMethodManager) service.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(field, 0);
        });
    }

    // ------------------------------------------------------------------ the dot and the tab

    private View makeDot() {
        FrameLayout view = new FrameLayout(service);
        dotRound = new GradientDrawable();
        dotRound.setShape(GradientDrawable.OVAL);
        dotRound.setColor(BG);
        view.setBackground(dotRound);
        view.setAlpha(0.72f); // see-through: the app below stays readable
        dotMark = new ImageView(service);
        dotMark.setImageResource(R.drawable.ic_stat_autark);
        view.addView(dotMark, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        dotCheck = new TextView(service);
        dotCheck.setText("✓");
        dotCheck.setTextColor(Color.WHITE);
        dotCheck.setTextSize(18);
        dotCheck.setGravity(Gravity.CENTER);
        dotCheck.setVisibility(View.GONE);
        view.addView(dotCheck, new FrameLayout.LayoutParams(-1, -1));
        view.setContentDescription(german ? "Autark-Aufgabe" : "Autark to-do");
        view.setOnClickListener((v) -> open());
        // An accessibility service's long-click (no finger to lift) puts the dot at the edge; the finger's hold is the quick task.
        view.setOnLongClickListener((v) -> { toTab(TodoPlace.left(params.x, dp(DOT_DP), screen()[0])); return true; });
        float slop = ViewConfiguration.get(service).getScaledTouchSlop();
        view.setOnTouchListener(new View.OnTouchListener() {
            private float downX, downY;
            private int startX, startY;
            private boolean dragging, held;
            private final Runnable hold = () -> { held = true; holdStart(); };

            @Override public boolean onTouch(View v, MotionEvent event) {
                if (params == null) return false;
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX(); downY = event.getRawY();
                        startX = params.x; startY = params.y;
                        dragging = false; held = false;
                        main.postDelayed(hold, HOLD_MS);
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                        if (!dragging && !held && TodoPlace.dragged(dx, dy, slop)) { dragging = true; main.removeCallbacks(hold); }
                        if (dragging) {
                            int[] screen = screen();
                            params.x = TodoPlace.clamp(startX + Math.round(dx), dp(DOT_DP), screen[0]);
                            params.y = TodoPlace.clamp(startY + Math.round(dy), dp(DOT_DP), screen[1]);
                            update();
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        main.removeCallbacks(hold);
                        if (held) { holdRelease(); return true; }
                        if (dragging) {
                            int screenWidth = screen()[0];
                            place.edit().putInt("x", params.x).putInt("y", params.y).apply();
                            if (TodoPlace.droppedAtEdge(event.getRawX(), screenWidth, dp(EDGE_DP))) toTab(event.getRawX() < screenWidth / 2f);
                        } else {
                            v.performClick();
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        main.removeCallbacks(hold);
                        if (held) holdRelease();
                        return true;
                    default:
                        return false;
                }
            }
        });
        return view;
    }

    private View makeTab() {
        View view = new View(service);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(BG);
        shape.setCornerRadius(dp(5));
        view.setBackground(shape);
        view.setAlpha(0.6f);
        view.setContentDescription(german ? "Autark-Aufgabe zeigen" : "Show Autark to-do");
        view.setOnClickListener((v) -> { place.edit().putBoolean("tab", false).apply(); show(Look.DOT); });
        return view;
    }

    private void toTab(boolean left) {
        place.edit().putBoolean("tab", true).putBoolean("left", left).putInt("y", params.y).apply();
        show(Look.TAB);
    }

    // ------------------------------------------------------------------ the hold: a quick task from the dot

    /** The finger rests on the dot: the screenshot now, then listening with the red ring (without the microphone right: just the shot). */
    private void holdStart() {
        if (busy || holding || look != Look.DOT) return;
        holding = true;
        holdRound++;
        released = false;
        holdWords = "";
        holdJpeg = null;
        holdThumb = null;
        quick.clear();
        if (Build.VERSION.SDK_INT >= 30) run(() -> {
            byte[][] jpeg = new byte[1][];
            Bitmap thumb = shot(jpeg);
            holdJpeg = jpeg[0];
            holdThumb = thumb;
        });
        if (service.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !SpeechRecognizer.isRecognitionAvailable(service)) return;
        dotRound.setStroke(dp(3), RED);
        holdSpeech = SpeechRecognizer.createSpeechRecognizer(service);
        holdSpeech.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle bundle) { }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rms) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onError(int error) { endHoldSpeech(); if (released) holdDone(); }
            @Override public void onResults(Bundle results) { heard(results); endHoldSpeech(); if (released) holdDone(); }
            @Override public void onPartialResults(Bundle partial) { heard(partial); }
            @Override public void onEvent(int type, Bundle bundle) { }
        });
        Intent listen = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, service.getPackageName());
        try { holdSpeech.startListening(listen); } catch (RuntimeException error) { endHoldSpeech(); }
    }

    private void heard(Bundle bundle) {
        List<String> words = bundle == null ? null : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (words != null && !words.isEmpty() && words.get(0) != null && !words.get(0).trim().isEmpty()) holdWords = words.get(0);
    }

    private void endHoldSpeech() {
        if (holdSpeech != null) {
            try { holdSpeech.destroy(); } catch (RuntimeException ignored) { /* already gone */ }
            holdSpeech = null;
        }
        if (dotRound != null) dotRound.setStroke(0, Color.TRANSPARENT);
    }

    /** The finger lifted: the recognizer hands over its last words (then holdDone), or – nothing listening – holdDone now. */
    private void holdRelease() {
        if (!holding || released) return;
        released = true;
        if (holdSpeech == null) { holdDone(); return; }
        try { holdSpeech.stopListening(); } catch (RuntimeException error) { endHoldSpeech(); holdDone(); return; }
        int round = holdRound;
        main.postDelayed(() -> { if (holding && released && round == holdRound) { endHoldSpeech(); holdDone(); } }, 4_000); // a recognizer that never answers
    }

    /** The hold is over: its words go out with its shot, or – no words – the panel opens with the shot. */
    private void holdDone() {
        if (!holding) return;
        holding = false;
        String text = holdWords.trim();
        if (text.isEmpty()) {
            boolean mic = service.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            String note = !mic ? null : german ? "Nichts gehört – schreib es hier." : "Nothing heard – type it here.";
            run(() -> main.post(() -> holdToPanel("", null, note))); // after the worker's capture job: the shot is there (or none came)
            return;
        }
        UseLink link = UseLink.linked();
        busy = true;
        run(() -> {
            String note;
            try {
                if (holdJpeg != null && quick.shots().isEmpty()) quick.add(holdJpeg);
                String[] task = deliver(link, text, quick);
                if (task == null) throw new Failed(german ? "Der PC hat keine Aufgabe zurückgegeben." : "The PC gave no task back.");
                main.post(this::holdSent);
                return;
            } catch (Failed error) {
                note = error.getMessage();
            } catch (RuntimeException error) {
                android.util.Log.w("autark", "to-do quick send failed: " + error.getClass().getName());
                note = german ? "Senden ging nicht." : "Sending failed.";
            }
            String line = note;
            main.post(() -> { busy = false; holdToPanel(text, quick.clientId(), line); });
        });
    }

    private void holdSent() {
        busy = false;
        quick.clear();
        holdJpeg = null;
        holdThumb = null;
        if (dotMark == null) return;
        dotMark.setVisibility(View.GONE);
        dotCheck.setVisibility(View.VISIBLE);
        main.postDelayed(() -> { if (dotMark != null) { dotCheck.setVisibility(View.GONE); dotMark.setVisibility(View.VISIBLE); } }, DONE_MS);
    }

    /** Nothing lost: the panel with the hold's shot, its words and one line (a failed post's client id goes along). */
    private void holdToPanel(String words, String clientId, String note) {
        if (root == null) return;
        if (clientId != null) post.adopt(clientId);
        byte[] jpeg = holdJpeg;
        Bitmap thumb = holdThumb;
        if (jpeg != null && thumb != null && post.add(jpeg)) thumbs.add(thumb);
        holdJpeg = null;
        holdThumb = null;
        quick.clear();
        if (!words.isEmpty() && field != null) {
            String now = field.getText().toString().trim();
            field.setText(now.isEmpty() ? words : now + " " + words);
        }
        if (look != Look.PANEL) show(Look.PANEL);
        renderStrip();
        say(note);
    }

    // ------------------------------------------------------------------ the panel

    private LinearLayout makePanel() {
        LinearLayout view = new LinearLayout(service);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setPadding(dp(6), dp(4), dp(6), dp(6));
        GradientDrawable background = new GradientDrawable();
        background.setColor(BG);
        background.setCornerRadius(dp(16));
        view.setBackground(background);
        view.setAlpha(0.94f);
        LinearLayout row = new LinearLayout(service);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageView camera = icon(R.drawable.ic_todo_camera, german ? "Noch ein Screenshot" : "One more screenshot", this::shoot);
        if (Build.VERSION.SDK_INT < 30) camera.setVisibility(View.GONE); // screenshots need Android 11
        row.addView(camera);
        mic = icon(R.drawable.ic_todo_mic, german ? "Diktieren" : "Dictate", this::dictate);
        row.addView(mic);
        row.addView(new View(service), new LinearLayout.LayoutParams(0, 1, 1));
        row.addView(icon(R.drawable.ic_todo_call, german ? "Senden und anrufen" : "Send and call", () -> submit(true)));
        row.addView(icon(R.drawable.ic_todo_send, german ? "Als Aufgabe senden" : "Send as a task", () -> submit(false)));
        row.addView(icon(R.drawable.ic_todo_close, german ? "Zuklappen" : "Collapse", this::collapse));
        view.addView(row, new LinearLayout.LayoutParams(-1, -2));
        field = new EditText(service);
        field.setTextColor(Color.WHITE);
        field.setHintTextColor(Color.argb(150, 255, 255, 255));
        field.setHint(german ? "Was ist zu tun?" : "What needs doing?");
        field.setTextSize(14);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setMinLines(1);
        field.setMaxLines(4);
        field.setPadding(dp(8), dp(6), dp(8), dp(6));
        GradientDrawable box = new GradientDrawable();
        box.setColor(Color.argb(40, 255, 255, 255));
        box.setCornerRadius(dp(8));
        field.setBackground(box);
        field.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN && params != null && (params.flags & WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) != 0) typeHere();
            return false;
        });
        field.setText(draft);
        draft = "";
        view.addView(field, new LinearLayout.LayoutParams(-1, -2));
        strip = new LinearLayout(service);
        strip.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams stripAt = new LinearLayout.LayoutParams(-1, dp(THUMB_DP + 4));
        stripAt.topMargin = dp(4);
        view.addView(strip, stripAt);
        line = new TextView(service);
        line.setTextColor(Color.argb(220, 255, 255, 255));
        line.setTextSize(11);
        line.setMaxLines(2);
        LinearLayout.LayoutParams lineAt = new LinearLayout.LayoutParams(-1, -2);
        lineAt.topMargin = dp(2);
        view.addView(line, lineAt);
        renderStrip();
        say(null);
        return view;
    }

    private ImageView icon(int drawable, String says, Runnable action) {
        ImageView view = new ImageView(service);
        view.setImageResource(drawable);
        view.setContentDescription(says);
        view.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        view.setPadding(dp(7), dp(7), dp(7), dp(7));
        view.setOnClickListener((v) -> action.run());
        view.setLayoutParams(new LinearLayout.LayoutParams(dp(ICON_DP), dp(ICON_DP)));
        buttons.add(view);
        return view;
    }

    /** The dot tapped: the panel, and a screenshot of what is on the screen right now. */
    private void open() {
        if (look == Look.PANEL) return;
        show(Look.PANEL);
        shoot();
    }

    /** Back to the dot; the text and the shots stay for the next opening (gone only with the service). */
    private void collapse() {
        stopSpeech();
        show(Look.DOT);
    }

    private void say(String text) {
        if (line == null) return;
        line.setText(text == null ? "" : text);
        line.setVisibility(text == null || text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void setBusy(boolean on) {
        busy = on;
        for (ImageView button : buttons) button.setAlpha(on ? 0.4f : 1f);
    }

    // ------------------------------------------------------------------ screenshots

    private void shoot() {
        if (Build.VERSION.SDK_INT < 30 || busy) return;
        if (post.full()) { say(german ? "Höchstens " + TodoPost.MAX + " Screenshots." : "At most " + TodoPost.MAX + " screenshots."); return; }
        boolean typing = params != null && (params.flags & WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) == 0;
        if (typing) focusable(false); // the keyboard is not part of the screenshot
        run(() -> {
            byte[][] jpeg = new byte[1][];
            Bitmap thumb = shot(jpeg);
            if (thumb == null) { main.post(() -> say(german ? "Gerade kein Screenshot möglich." : "No screenshot right now.")); return; }
            byte[] bytes = jpeg[0];
            main.post(() -> {
                if (!post.add(bytes)) return;
                thumbs.add(thumb);
                renderStrip();
                say(null);
            });
        });
    }

    /** One screenshot (the worker thread): its JPEG (longest side at most 1600 px, quality 85) into jpeg[0], the thumbnail
     *  returned; null when Android gave none. */
    private Bitmap shot(byte[][] jpeg) throws InterruptedException {
        Bitmap full = service.capture();
        if (full == null) { // Android hands out one per second: once more after that
            Thread.sleep(1_100);
            full = service.capture();
        }
        if (full == null) return null;
        int[] size = TodoPlace.shotSize(full.getWidth(), full.getHeight());
        Bitmap scaled = size[0] == full.getWidth() ? full : Bitmap.createScaledBitmap(full, size[0], size[1], true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        scaled.compress(Bitmap.CompressFormat.JPEG, 85, out);
        jpeg[0] = out.toByteArray();
        int thumbHeight = dp(THUMB_DP);
        return Bitmap.createScaledBitmap(scaled, Math.max(1, Math.round(scaled.getWidth() * thumbHeight / (float) scaled.getHeight())), thumbHeight, true);
    }

    /** The thumbnails, in the order of post.shots(). */
    private final List<Bitmap> thumbs = new ArrayList<>();

    private void renderStrip() {
        strip.removeAllViews();
        List<TodoPost.Shot> shots = post.shots();
        for (int i = 0; i < shots.size() && i < thumbs.size(); i++) {
            TodoPost.Shot shot = shots.get(i);
            Bitmap thumb = thumbs.get(i);
            ImageView view = new ImageView(service);
            view.setImageBitmap(thumb);
            view.setScaleType(ImageView.ScaleType.CENTER_CROP);
            view.setContentDescription((german ? "Screenshot " : "Screenshot ") + (i + 1) + (german ? " entfernen" : ", remove"));
            view.setOnClickListener((v) -> {
                if (busy) return;
                post.remove(shot);
                thumbs.remove(thumb);
                renderStrip();
            });
            LinearLayout.LayoutParams at = new LinearLayout.LayoutParams(dp(THUMB_DP * 2 / 3), dp(THUMB_DP));
            at.setMarginEnd(dp(4));
            strip.addView(view, at);
        }
        strip.setVisibility(shots.isEmpty() ? View.GONE : View.VISIBLE);
        if (look == Look.PANEL && params != null) { // a taller panel stays whole on the screen
            int y = TodoPlace.clamp(params.y, panelHeight(), screen()[1]);
            if (y != params.y) { params.y = y; update(); }
        }
    }

    // ------------------------------------------------------------------ dictation

    private void dictate() {
        if (speech != null) { speech.stopListening(); return; } // a second tap ends the take
        if (service.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            collapse();
            openApp(null); // the app asks for the microphone where the person sees why
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(service)) { say(german ? "Keine Spracherkennung auf diesem Handy." : "No speech recognition on this phone."); return; }
        String now = field.getText().toString();
        spokenBefore = now.isEmpty() || now.endsWith(" ") || now.endsWith("\n") ? now : now + " ";
        speech = SpeechRecognizer.createSpeechRecognizer(service);
        speech.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle bundle) { say(german ? "Ich höre …" : "Listening …"); }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rms) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onError(int error) {
                stopSpeech();
                say(error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                        ? (german ? "Nichts verstanden." : "Didn't catch that.") : (german ? "Diktat ging nicht." : "Dictation failed."));
            }
            @Override public void onResults(Bundle results) { words(results); stopSpeech(); say(null); }
            @Override public void onPartialResults(Bundle partial) { words(partial); }
            @Override public void onEvent(int type, Bundle bundle) { }
        });
        Intent listen = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, service.getPackageName());
        mic.setColorFilter(Color.rgb(255, 79, 0)); // Autark orange while it listens
        try { speech.startListening(listen); } catch (RuntimeException error) { stopSpeech(); say(german ? "Diktat ging nicht." : "Dictation failed."); }
    }

    private void words(Bundle bundle) {
        List<String> heard = bundle == null ? null : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (heard == null || heard.isEmpty() || heard.get(0) == null || field == null) return;
        field.setText(spokenBefore + heard.get(0));
        field.setSelection(field.getText().length());
    }

    private void stopSpeech() {
        if (speech != null) {
            try { speech.destroy(); } catch (RuntimeException ignored) { /* already gone */ }
            speech = null;
        }
        if (mic != null) mic.clearColorFilter();
    }

    // ------------------------------------------------------------------ send and call

    /** One RPC answer, or the PC's error as a Failed. */
    private static final class Failed extends Exception { Failed(String message) { super(message); } }

    private interface Job { void run() throws Exception; }

    private void run(Job job) {
        try {
            work.execute(() -> {
                try { job.run(); }
                catch (InterruptedException stop) { Thread.currentThread().interrupt(); }
                catch (Exception error) { android.util.Log.w("autark", "to-do step failed: " + error.getClass().getName()); }
            });
        } catch (RuntimeException shutDown) { /* the service went off */ }
    }

    private void submit(boolean call) {
        if (busy) return;
        stopSpeech();
        String text = field.getText().toString().trim();
        List<TodoPost.Shot> shots = post.shots();
        if (text.isEmpty() && shots.isEmpty()) { say(german ? "Schreib oder sag, was zu tun ist." : "Type or say what needs doing."); return; }
        UseLink link = UseLink.linked();
        if (link == null) { say(german ? "Gerade nicht mit deinem PC verbunden." : UseLink.UNLINKED); return; }
        post.clientId(); // made now: a retry sends the same one
        setBusy(true);
        focusable(false);
        say(german ? "Wird gesendet …" : "Sending …");
        run(() -> {
            try {
                String[] task = deliver(link, text, post);
                if (task == null) throw new Failed(german ? "Der PC hat keine Aufgabe zurückgegeben." : "The PC gave no task back.");
                String route = null;
                if (call) {
                    String agent = TodoPost.callee(task);
                    if (agent != null) {
                        try { // the task is in; a chat this phone may not open (no right to start chats) opens the task instead
                            Object chat = answer(link, "chats.direct", Json.map("memberId", agent));
                            @SuppressWarnings("unchecked") String chatId = chat instanceof Map ? Json.str((Map<String, Object>) chat, "id") : null;
                            route = PhoneRoutes.call(chatId);
                        } catch (Failed refused) { route = null; }
                    }
                    if (route == null) route = PhoneRoutes.task(task[0]);
                }
                String open = route;
                main.post(() -> sent(call, open));
            } catch (Failed error) {
                main.post(() -> { setBusy(false); say(error.getMessage()); });
            } catch (RuntimeException error) {
                android.util.Log.w("autark", "to-do send failed: " + error.getClass().getName());
                main.post(() -> { setBusy(false); say(german ? "Senden ging nicht." : "Sending failed."); });
            }
        });
    }

    /** The worker thread: every shot of `from` up (each once), then tasks.quickCreate with its client id; the task read
     *  from the answer, or null. */
    private String[] deliver(UseLink link, String text, TodoPost from) throws Failed, InterruptedException {
        if (link == null) throw new Failed(german ? "Gerade nicht mit deinem PC verbunden." : UseLink.UNLINKED);
        List<String[]> attachments = new ArrayList<>();
        for (TodoPost.Shot shot : from.shots()) {
            String name = from.name(shot);
            if (shot.fileId == null) {
                String id = TodoPost.fileId(answer(link, "files.upload", TodoPost.upload(name, shot.jpeg)));
                if (id == null) throw new Failed(german ? "Der PC hat den Screenshot nicht angenommen." : "The PC did not take the screenshot.");
                shot.fileId = id;
            }
            attachments.add(new String[] { shot.fileId, name });
        }
        return TodoPost.task(answer(link, "tasks.quickCreate", TodoPost.create(text, attachments, from.clientId())));
    }

    /** One call to the PC, waited for on this worker thread (at most CALL_MS). */
    private Object answer(UseLink link, String method, Map<String, Object> params) throws Failed, InterruptedException {
        AtomicReference<Object> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        link.call(method, params, new UseLink.Answer() {
            @Override public void result(Object value) { result.set(value); done.countDown(); }
            @Override public void error(String message) { error.set(message); done.countDown(); }
        });
        if (!done.await(CALL_MS, TimeUnit.MILLISECONDS)) throw new Failed(german ? "Der PC hat nicht geantwortet." : "The PC did not answer.");
        if (error.get() != null) throw new Failed(error.get());
        return result.get();
    }

    /** The task is there: ✓, empty, back to the dot – and for a call the chat (or the task) opens in the app. */
    private void sent(boolean call, String route) {
        post.clear();
        thumbs.clear();
        if (field != null) field.setText("");
        renderStrip();
        say("✓");
        if (call) openApp(route);
        main.postDelayed(() -> { setBusy(false); say(null); if (look == Look.PANEL) collapse(); }, call ? 0 : DONE_MS);
    }

    /** The app on screen, at `route` (PhoneRoutes) or where it was. */
    private void openApp(String route) {
        Intent intent = new Intent(service, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (route != null) intent.putExtra(PhoneRoutes.EXTRA, route);
        try { service.startActivity(intent); } catch (RuntimeException error) { say(german ? "Die App ging nicht auf." : "The app did not open."); }
    }
}
