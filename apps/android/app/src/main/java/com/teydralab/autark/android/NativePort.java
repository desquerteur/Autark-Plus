// Owns: the one channel between the PC's page and the app (B-084 decision 4). After every new main-frame document of
// the app's own origin it makes a WebMessageChannel, hands the page one end as 'autark-port' (posted to that origin
// only, so opaque-origin agent frames never get it), keeps the other and drops the previous one. Messages are JSON
// {t, …} both ways. Page → app: 'colors' (SystemBars), 'speak'/'stopSpeech' (PhoneSpeech), 'download' (PhoneDownloads),
// 'haptic' and 'shot' (16.11.2026: a picture of the app's own window for a feedback report – PixelCopy, longest side
// SHOT_SIDE, JPEG 85, answered as 'shot' {data} or {error}) are handled here; 'card', 'switch', 'add', 'forget', 'pcs'
// and 'refused' (the PC refused the page's token) go to the activity (Listener). App → page: send(), with the latest
// 'companies' and 'status' sent again to every new page, a crash report the person chose to send ('crash' {text},
// CrashReport's Report) once, to the first page that has its port – then the report's file goes –, and 'feedback'
// {down} (16.11.2026: volume up and down pressed together, MainActivity/VolumePair – the feedback cell's press). Never:
// addJavascriptInterface, a second port, a message from another origin, or a picture of anything but the app's window.
package com.teydralab.autark.android;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.util.function.Supplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class NativePort {
    /** What the page asks of the activity (main thread). */
    interface Listener {
        /** The current company's name and 64 px picture (data URL or null) – Companies.setCard. */
        void card(String name, String avatar);
        /** Switch to this company (an id from the 'companies' list). */
        void switchCompany(String id);
        /** Add a company: the pairing screens, Back returns. */
        void addCompany();
        /** Forget this phone (the current company): the same confirm as autark-app:forget. */
        void forget();
        /** Show the PC picker of the current company. */
        void pickPc();
        /** The PC refused the page's token (4401): the page goes to the next PC of the company that has not refused. */
        void refused();
    }

    private static final String TAG = "AutarkPort";
    /** The longest side of a window picture (the PC's feedback form shows it full size). */
    static final int SHOT_SIDE = 1600;
    /** As much of a crash report as a feedback report carries (the PC keeps clientDiagnostics to 12 000 characters). */
    static final int CRASH_CHARS = 12_000;
    private final Activity activity;
    private final Supplier<String> origin;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final PhoneSpeech speech;
    private final PhoneDownloads downloads;
    private WebMessagePort port;
    private WebView view;
    private JSONObject companies;
    private JSONObject status;
    private String crash;

    NativePort(Activity activity, Supplier<String> origin, Listener listener) {
        this.activity = activity;
        this.origin = origin;
        this.listener = listener;
        this.speech = new PhoneSpeech(activity, (id) -> send(message("speechDone", "id", id)));
        this.downloads = new PhoneDownloads(activity, (name) -> send(message("saved", "name", name)));
    }

    /** A new main-frame document finished loading in view (PhoneNavigation: newDocument). Main thread. */
    void pageLoaded(WebView loaded, String url) {
        String own = origin.get();
        if (own == null || !ConnectionAddress.sameOrigin(own, url)) return;
        close();
        // A stored file opened as the whole page (GET /files/<sha>) is the person's content, not the app: no port.
        String path = Uri.parse(url).getPath();
        if (path != null && path.startsWith("/files/")) return;
        WebMessagePort[] ends = loaded.createWebMessageChannel();
        WebMessagePort mine = ends[0];
        mine.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort from, WebMessage message) { if (port == mine) receive(message.getData()); }
        }, main);
        loaded.postWebMessage(new WebMessage("autark-port", new WebMessagePort[] { ends[1] }), Uri.parse(own));
        port = mine;
        view = loaded;
        if (companies != null) send(companies);
        if (status != null) send(status);
        sendCrash();
    }

    /** The last crash's report the person chose to send (main thread): it goes to the page once it has its port. */
    void crash(String report) {
        crash = report.length() > CRASH_CHARS ? report.substring(0, CRASH_CHARS) : report;
        sendCrash();
    }

    private void sendCrash() {
        if (crash == null || !send(message("crash", "text", crash))) return;
        crash = null;
        CrashReport.clear(activity); // handed over: the page keeps it in its report (and its outbox while the PC is away)
    }

    /** App → page; false while the page has no port. Any thread. */
    boolean send(JSONObject message) {
        WebMessagePort target = port;
        if (target == null || message == null) return false;
        String text = message.toString();
        main.post(() -> { if (port == target) target.postMessage(new WebMessage(text)); });
        return true;
    }

    /** The company list (Companies.listJson) – kept and sent again to every new page. */
    void companies(String listJson) {
        try { companies = new JSONObject().put("t", "companies").put("list", new JSONArray(listJson)); } catch (JSONException error) { return; }
        send(companies);
    }

    /** The connection line: the PC tunnelled to (or null) and whether the link is up – kept and sent again to every new page. */
    void status(String pc, boolean connected) {
        try { status = new JSONObject().put("t", "status").put("connected", connected); if (pc != null) status.put("pc", pc); } catch (JSONException error) { return; }
        send(status);
    }

    /** Shared into Autark: the text (or null) and how many files wait for the page's next file chooser. */
    void share(String text, int files) {
        try { JSONObject out = new JSONObject().put("t", "share").put("files", files); if (text != null) out.put("text", text); send(out); } catch (JSONException ignored) { /* never for these values */ }
    }

    /** The link came back after a pause or a network change: the page refreshes its data. */
    void resume() { send(message("resume")); }

    /** Volume up and down together went down (true) or were let go (false): the page presses its feedback cell. */
    void feedback(boolean down) {
        try { send(new JSONObject().put("t", "feedback").put("down", down)); } catch (JSONException ignored) { /* never for these values */ }
    }

    PhoneDownloads downloads() { return downloads; }

    /** The page is gone (renderer gone, forget, onDestroy): ends the port, the voice and a half-received file. */
    void dispose() {
        close();
        speech.shutdown();
    }

    private void close() {
        if (port != null) { try { port.close(); } catch (IllegalStateException ignored) { /* already closed */ } }
        port = null;
        view = null;
        speech.stop();
        downloads.cancel();
    }

    private void receive(String data) {
        JSONObject in;
        try { in = new JSONObject(data == null ? "" : data); } catch (JSONException error) { Log.w(TAG, "not JSON"); return; }
        switch (in.optString("t")) {
            case "colors": SystemBars.apply(text(in, "top"), text(in, "bottom")); break;
            case "speak": speech.speak(text(in, "id"), text(in, "text"), text(in, "lang")); break;
            case "stopSpeech": speech.stop(); break;
            case "download": downloads.chunk(text(in, "name"), text(in, "mime"), text(in, "data"), in.optBoolean("last"), in.optInt("seq", -1)); break;
            case "haptic": if (view != null) view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); break;
            case "card": listener.card(text(in, "name"), text(in, "avatar")); break;
            case "switch": { String id = text(in, "id"); if (id != null) listener.switchCompany(id); break; }
            case "add": listener.addCompany(); break;
            case "forget": listener.forget(); break;
            case "pcs": listener.pickPc(); break;
            case "refused": listener.refused(); break;
            case "shot": shot(); break;
            default: Log.w(TAG, "unknown message " + in.optString("t"));
        }
    }

    /** A picture of the app's own window (main thread): PixelCopy, then scaled and encoded off the main thread. */
    private void shot() {
        Window window = activity.getWindow();
        View decor = window == null ? null : window.peekDecorView();
        if (decor == null || decor.getWidth() <= 0 || decor.getHeight() <= 0) { send(message("shot", "error", "The app's window is not drawn yet.")); return; }
        Bitmap full = Bitmap.createBitmap(decor.getWidth(), decor.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(window, full, (result) -> {
                if (result != PixelCopy.SUCCESS) { full.recycle(); send(message("shot", "error", "Android did not copy the window (" + result + ").")); return; }
                Thread encode = new Thread(() -> send(encoded(full)), "autark-shot");
                encode.setDaemon(true);
                encode.start();
            }, main);
        } catch (IllegalArgumentException | IllegalStateException error) {
            full.recycle();
            send(message("shot", "error", "Android did not copy the window."));
        }
    }

    /** The picture as {t:'shot', data:'data:image/jpeg;base64,…'} (longest side at most SHOT_SIDE). */
    private static JSONObject encoded(Bitmap full) {
        try {
            float scale = Math.min(1f, SHOT_SIDE / (float) Math.max(full.getWidth(), full.getHeight()));
            Bitmap sized = scale >= 1f ? full : Bitmap.createScaledBitmap(full, Math.round(full.getWidth() * scale), Math.round(full.getHeight() * scale), true);
            ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
            sized.compress(Bitmap.CompressFormat.JPEG, 85, jpeg);
            if (sized != full) sized.recycle();
            return message("shot", "data", "data:image/jpeg;base64," + Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP));
        } catch (RuntimeException | OutOfMemoryError error) {
            return message("shot", "error", "The picture could not be made on this phone.");
        } finally {
            full.recycle();
        }
    }

    private static String text(JSONObject in, String key) { return in.isNull(key) ? null : in.optString(key, null); }

    private static JSONObject message(String type, String... pairs) {
        JSONObject out = new JSONObject();
        try { out.put("t", type); for (int i = 0; i + 1 < pairs.length; i += 2) out.put(pairs[i], pairs[i + 1]); } catch (JSONException ignored) { /* never for strings */ }
        return out;
    }
}
