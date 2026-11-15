// Owns: the native shell – the companies this phone is paired with (Companies; each its own local port and origin) and
// the switch between them, pairing by the PC's Remote ID through the native screens (pair/PairScreens: scanner, photo
// strip, code; the same screens for "Add a company", where Back returns), the one live link of the current company
// (CompanyLink; linked to every PC of the company, the page on one of them – a move to a PC with another Autark version
// reloads the page, B-084 M1), the WebView (PhoneWeb) that shows the PC's unchanged phone UI and its one page↔app channel (NativePort),
// the system bar strips (SystemBars), places opened from notifications, shortcuts and a recreation (PhoneRoutes), shares
// into Autark (ShareIn), the foreground service while paired (KeepAlive), the phone-use upgrade's dialog and a crashed
// renderer's recovery. Back goes back layer by layer in the web UI (window.autarkBack) and, with nothing left, puts the
// app in the background – it never closes itself. Its own screen besides pairing: "can't reach" (OfflineScreen), which
// opens the page again by itself once a PC of the company is linked.
// Above them all, the update line (UpdateBar, UpdateCheck) when a newer Autark is there. Before everything, the last
// start's crash report when there is one (CrashReport); a failing optional part (bar colours, the foreground service,
// the notification question, the update line) never keeps the app from showing its screen.
// Never: copies the UI, needs a VPN or a reachable PC address, reads the UI's storage, or runs agents.
package com.teydralab.autark.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import com.teydralab.autark.android.pair.PairRun;
import com.teydralab.autark.android.pair.PairScreens;
import com.teydralab.autark.android.relay.PhoneConnection;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

public final class MainActivity extends Activity implements PhoneNavigation.Host, NativePort.Listener {
    /** The current company's live link for the whole process (it outlives a recreated activity). */
    private static CompanyLink link;
    /** The activity on screen: the process-wide link reports there. */
    private static volatile MainActivity current;
    private static final CompanyLink.Events EVENTS = new CompanyLink.Events() {
        @Override public void status(String text, boolean connected) { on(shown -> shown.linkStatus(text, connected)); }
        @Override public void linked() { on(MainActivity::moved); }
        @Override public void pcs(String company, List<PhoneConnection.Pc> pcs) { on(shown -> { shown.companies.setPcs(company, pcs); shown.sendCompanies(); }); }
    };

    private WebView web;
    private PhoneChrome chrome;
    private FrameLayout content;
    private UpdateBar updates;
    private TextView status;
    private SharedPreferences preferences;
    private Companies companies;
    private NativePort port;
    private String origin;
    private boolean setup;
    private boolean pageUp;
    private boolean resetHistory;
    private PhoneConnection.Pairing pairing;
    private String pendingRoute;
    private ShareIn.Shared pendingShare;
    /** The Autark version of the PC that served the page on screen (null: unknown). */
    private String pageVersion;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String crash = CrashReport.last(this); // the last start's crash comes first, before anything that could crash again
        if (crash != null) { CrashReport.show(this, crash, () -> { start(state); resumed(); }); return; }
        start(state);
    }

    /** The app itself; until it ran (port == null) the lifecycle methods below leave everything alone. */
    private void start(Bundle state) {
        current = this;
        preferences = getSharedPreferences("pairing", MODE_PRIVATE);
        getSharedPreferences("connection", MODE_PRIVATE).edit().clear().apply(); // 0.1.0's https origin is no longer used
        companies = CompanyLink.companies(this, preferences);
        port = new NativePort(this, () -> origin, this);
        content = new FrameLayout(this);
        updates = new UpdateBar(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.addView(updates.view, new LinearLayout.LayoutParams(-1, -2));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root); // first: the window's decor exists before SystemBars asks it for the insets controller
        optional(() -> { SystemBars.install(this, root, content); PairScreens.bars(SystemBars::apply); });
        createWebView();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        pendingRoute = state == null ? null : PhoneRoutes.place(state.getString("route"));
        PhoneConnection.Paired paired = companies.current();
        if (paired != null) open(paired); else showPair(null, false); // onResume shows the update line (UpdateCheck)
        if (state == null) arrive(getIntent()); // a recreated activity already handled its intent
    }

    /** A part the screen does without (bar colours, the notification question, the update line): its failure never stops the app. */
    private static void optional(Runnable step) {
        try { step.run(); } catch (RuntimeException error) { Log.w("Autark", "optional start step failed", error); }
    }

    /** The activity on screen, or null (where UpdateCheck delivers a background answer, and "Try again"). */
    static MainActivity shown() { return current; }

    /** This screen's update line. */
    UpdateBar updates() { return updates; }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (port != null) arrive(intent);
    }

    /** A pair link, a place (notification, shortcut), a share or the phone-use upgrade's tap. */
    private void arrive(Intent intent) {
        if (intent == null) return;
        String linked = ConnectionAddress.fromLink(intent.getDataString());
        if (linked != null) showPair(linked, companies.size() > 0);
        String route = AppNotices.route(intent);
        if (route != null) { if (pageUp) web.evaluateJavascript("location.hash='" + route + "'", null); else pendingRoute = route; }
        ShareIn.Shared shared = ShareIn.accept(intent);
        if (shared != null) { if (pageUp) port.share(shared.text, shared.files); else pendingShare = shared; }
        if (PhoneUseUpgrade.wanted(intent)) { intent.removeExtra(PhoneUseUpgrade.EXTRA); PhoneUseUpgrade.start(this, updates::step); }
    }

    private void createWebView() {
        web = PhoneWeb.create(this, () -> origin, this);
        chrome = new PhoneChrome(this, web, () -> origin);
        web.setWebChromeClient(chrome);
    }

    // ------------------------------------------------------------------ companies and the link

    /** Starts (or reuses) the current company's link, lets only this WebView through its local entrance, opens the PC's UI. */
    private void open(PhoneConnection.Paired paired) {
        PairScreens.stop();
        String gate = CompanyLink.gate(preferences);
        if (link == null || !link.company.equals(companies.currentId())) {
            teardown();
            try { link = CompanyLink.open(this, companies.currentId(), paired, companies.port(), gate, EVENTS); }
            catch (IOException error) { showPair(null, false); PairScreens.status("The app could not open its local entrance: " + error.getMessage()); return; }
            catch (IllegalArgumentException error) { showPair(null, false); PairScreens.status("This phone's stored pairing could not be read; pair it once more."); return; }
        }
        optional(() -> KeepAlive.start(this, null));
        origin = link.origin;
        linkStatus(null, link.pcName() != null);
        PhoneWeb.admit(origin, gate);
        chrome.cancelMedia();
        setup = false;
        pageUp = false;
        content.removeAllViews();
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.onResume();
        resetHistory = true;
        // The phone UI keeps the token itself (lib/rpc-token.ts reads #token=, stores it and clears the address); a place follows in pageReady.
        web.loadUrl(origin + "/#token=" + Uri.encode(paired.token));
        optional(() -> AppNotices.askOnce(this, preferences));
    }

    private void teardown() {
        port.dispose(); // the old company's page (a late 'card' or 'switch') never reaches the next company
        if (link != null) link.stop(this);
        link = null;
    }

    /** Another company (or the one just paired again): its own link and origin. */
    private void switchTo(String id) {
        if (!companies.setCurrent(id)) return;
        teardown();
        open(companies.current());
    }

    /** The pairing levels; adding: Back on the first level returns to the current company. */
    private void showPair(String remoteId, boolean adding) {
        leaveWeb();
        status = null;
        if (pairing != null) { pairing.cancel(); pairing = null; } // a new pair link replaces a running pairing
        PairScreens.show(this, content, remoteId, adding, this::pairOrCancel, adding ? () -> { PhoneConnection.Paired p = companies.current(); if (p != null) open(p); else showPair(null, false); } : null);
    }

    /** An ID from the levels starts the pairing (its success adds the company); null cancels the wait. */
    private void pairOrCancel(String id) {
        if (pairing != null) { pairing.cancel(); pairing = null; }
        if (id == null) return;
        PhoneConnection.Pairing[] running = new PhoneConnection.Pairing[1];
        running[0] = pairing = PairRun.start(this, id, (paired) -> {
            if (pairing != running[0]) return;
            pairing = null;
            if (paired != null) { PairScreens.stop(); switchTo(companies.add(paired)); }
        });
    }

    /** The web UI could not load: the reason, Try again, and Forget (the web profile menu is out of reach). */
    @Override public void offline(String reason) {
        if (setup) return;
        leaveWeb();
        PairScreens.stop();
        status = OfflineScreen.show(this, content, reason, () -> {
            PhoneConnection.Paired paired = companies.current();
            if (link != null) link.connection.check();
            if (paired != null) open(paired);
        }, this::confirmForget);
    }

    /** "Forget this phone" (the profile menu: autark-app:forget or the port's 'forget') – the current company only. */
    @Override public void confirmForget() {
        new AlertDialog.Builder(this)
                .setMessage("Sign this phone out of this company and remove its pairing here? On the PC, remove it under Settings › Devices too.")
                .setNegativeButton("Cancel", null).setPositiveButton("Forget", (dialog, which) -> forgetCurrent()).show();
    }

    private void forgetCurrent() {
        String gone = origin;
        teardown();
        leaveWeb();
        port.dispose();
        PhoneWeb.forgetOrigin(web, gone);
        origin = null;
        ShareIn.clear();
        pendingShare = null;
        PhoneConnection.Paired next = companies.remove(companies.currentId()) == null ? null : companies.current();
        if (next != null) { open(next); return; }
        KeepAlive.stop(this);
        preferences.edit().remove("gate").apply();
        showPair(null, false);
    }

    private void leaveWeb() {
        setup = true;
        pageUp = false;
        chrome.cancelMedia();
        web.stopLoading();
        web.loadUrl("about:blank"); // Leaving the app page releases its live camera/microphone streams.
        web.onPause();
        SystemBars.apply(null, null);
    }

    /** The link's line: the "can't reach" screen's text and the page's 'status' and 'companies'. */
    private void linkStatus(String text, boolean connected) {
        if (status != null && text != null) status.setText(text);
        port.status(connected && link != null ? link.pcName() : null, connected);
        sendCompanies();
    }

    private void sendCompanies() { port.companies(companies.listJson(link == null ? null : link.pcName())); }

    /** The page moved to another channel (B-084 M1): a PC with another Autark version shows its own UI, else the page reconnects. */
    private void moved() {
        if (setup && status != null && pairing == null) { PhoneConnection.Paired paired = companies.current(); if (paired != null) open(paired); return; } // the "can't reach" screen: the page opens again on the PC now linked
        String now = link == null ? null : link.connection.version();
        if (pageUp && now != null && pageVersion != null && !now.equals(pageVersion)) { pageUp = false; web.reload(); }
        else port.resume();
    }

    private static void on(Consumer<MainActivity> step) {
        MainActivity shown = current;
        if (shown != null) shown.runOnUiThread(() -> { if (current == shown && !shown.isDestroyed()) step.accept(shown); });
    }

    // ------------------------------------------------------------------ the page (PhoneNavigation.Host, NativePort.Listener)

    @Override public boolean sameOrigin(String url) { return origin != null && ConnectionAddress.sameOrigin(origin, url); }

    @Override public void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!(scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto") || scheme.equals("tel"))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { Toast.makeText(this, "No app is installed to open this link.", Toast.LENGTH_SHORT).show(); }
    }

    @Override public void pageReady(WebView view, String url, boolean newDocument) {
        if (view != web || setup) return;
        if (resetHistory) { web.clearHistory(); resetHistory = false; }
        if (!newDocument) return;
        port.pageLoaded(view, url);
        pageUp = true;
        pageVersion = link == null ? null : link.connection.version();
        if (pendingShare != null) { port.share(pendingShare.text, pendingShare.files); pendingShare = null; }
        if (pendingRoute != null) { web.evaluateJavascript("location.hash='" + pendingRoute + "'", null); pendingRoute = null; }
    }

    /** The renderer crashed or was killed: a new WebView on the same place. */
    @Override public void rendererGone(WebView view) {
        if (view != web) return;
        String place = PhoneRoutes.place(view.getUrl());
        port.dispose();
        chrome.dispose();
        content.removeView(view);
        view.destroy();
        createWebView();
        pageUp = false;
        if (setup) return;
        pendingRoute = place;
        PhoneConnection.Paired paired = companies.current();
        if (paired != null) open(paired); else showPair(null, false);
    }

    @Override public void card(String name, String avatar) { companies.setCard(name, avatar); sendCompanies(); }

    @Override public void switchCompany(String id) { if (!id.equals(companies.currentId())) switchTo(id); }

    @Override public void addCompany() { showPair(null, true); }

    @Override public void forget() { confirmForget(); }

    @Override public void pickPc() { if (link != null) link.pick(this, EVENTS); }

    // ------------------------------------------------------------------ Back and the lifecycle

    /** Back: the pairing levels walk back; a native screen returns to the app; the web UI goes back one layer; with none left the app goes to the background. */
    private void goBack() {
        if (port == null) { moveTaskToBack(true); return; } // the crash report's screen
        if (setup && PairScreens.back()) return;
        PhoneConnection.Paired paired = companies.current();
        if (setup && paired != null && pairing == null) { open(paired); return; }
        if (setup) { moveTaskToBack(true); return; }
        web.evaluateJavascript("(function(){try{return window.autarkBack?window.autarkBack():false}catch(e){return false}})()",
                (value) -> { if (!"true".equals(value)) moveTaskToBack(true); });
    }

    // API 33+ uses the OnBackInvokedDispatcher above; this callback covers Android 8–12.
    @SuppressLint("GestureBackNavigation") @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onResume() {
        super.onResume();
        if (port != null) resumed();
    }
    private void resumed() {
        current = this;
        AppNotices.resumed(true);
        optional(() -> AppNotices.clear(this));
        if (link != null) { link.connection.check(); optional(() -> KeepAlive.start(this, null)); }
        if (web != null && !setup) web.onResume();
        optional(() -> SelfUpdate.resumed(this, updates::step));
        optional(() -> UpdateCheck.start(this, updates));
    }
    @Override protected void onPause() { AppNotices.resumed(false); if (web != null) { web.onPause(); CookieManager.getInstance().flush(); } super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        String place = web == null || setup ? null : PhoneRoutes.place(web.getUrl());
        if (place != null) out.putString("route", place);
    }
    @Override protected void onDestroy() {
        if (current == this) current = null;
        if (pairing != null) { pairing.cancel(); pairing = null; } // a recreated activity shows the first level again
        PairScreens.stop();
        if (port != null) port.dispose();
        if (chrome != null) chrome.dispose();
        if (web != null) { content.removeAllViews(); web.destroy(); }
        super.onDestroy();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (!PairScreens.onPermissionResult(code, results) && chrome != null) chrome.permissionResult(code);
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (!PairScreens.onActivityResult(code, result, data) && chrome != null) chrome.activityResult(code, result, data);
    }
}
