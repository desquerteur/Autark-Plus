// Owns: the one channel between the PC's page and the app (B-084 decision 4). After every new main-frame document of
// the app's own origin it makes a WebMessageChannel, hands the page one end as 'autark-port' (posted to that origin
// only, so opaque-origin agent frames never get it), keeps the other and drops the previous one. Messages are JSON
// {t, …} both ways. Page → app: 'colors' (SystemBars), 'speak'/'stopSpeech' (PhoneSpeech), 'download' (PhoneDownloads)
// and 'haptic' are handled here; 'card', 'switch', 'add', 'forget' and 'pcs' go to the activity (Listener). App → page:
// send(), with the latest 'companies' and 'status' sent again to every new page. Never: addJavascriptInterface, a
// second port, or a message from another origin.
package com.teydralab.autark.android;

import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
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
    }

    private static final String TAG = "AutarkPort";
    private final Supplier<String> origin;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final PhoneSpeech speech;
    private final PhoneDownloads downloads;
    private WebMessagePort port;
    private WebView view;
    private JSONObject companies;
    private JSONObject status;

    NativePort(Activity activity, Supplier<String> origin, Listener listener) {
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
            default: Log.w(TAG, "unknown message " + in.optString("t"));
        }
    }

    private static String text(JSONObject in, String key) { return in.isNull(key) ? null : in.optString(key, null); }

    private static JSONObject message(String type, String... pairs) {
        JSONObject out = new JSONObject();
        try { out.put("t", type); for (int i = 0; i + 1 < pairs.length; i += 2) out.put(pairs[i], pairs[i + 1]); } catch (JSONException ignored) { /* never for strings */ }
        return out;
    }
}
