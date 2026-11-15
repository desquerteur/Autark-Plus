// Owns: the one live link of the current company for the whole app process (B-084, decisions 7 and 8): its connection
// (relay/PhoneConnection) behind the company's own local port (its own origin), the phone-use socket (phoneuse/UseLink),
// the network callback pointed at it (relay/NetworkWake), the line of the ongoing notification (KeepAlive: "Connected to
// <the page's PC> (+N)", N = the company's other PCs the phone is linked to as well, B-084 M1) and the PC picker – the
// PCs of the company in the phone's order, which one the page uses and which are online; a pick makes the page use that
// PC. Also where the company list and the entrance's gate secret are kept (SharedPreferences under Companies).
// Events go to the activity on screen (MainActivity forwards them). Never: decides a pairing's record (Companies does),
// touches the WebView, or keeps two companies' links at once.
package com.teydralab.autark.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import com.teydralab.autark.android.phoneuse.UseLink;
import com.teydralab.autark.android.relay.Crypto;
import com.teydralab.autark.android.relay.NetworkWake;
import com.teydralab.autark.android.relay.PhoneConnection;
import java.io.IOException;
import java.util.List;

final class CompanyLink {
    /** What the link reports (any thread). */
    interface Events {
        void status(String text, boolean connected);
        /** A new channel to a PC is up (after a pause, a network change or a PC switch): the page refreshes. */
        void linked();
        /** The company's PCs changed (phoneUse.attach or the picker): the caller stores them for `company`. */
        void pcs(String company, List<PhoneConnection.Pc> pcs);
    }

    final String company;
    final String origin;
    final PhoneConnection connection;
    private final UseLink use;

    private CompanyLink(String company, String origin, PhoneConnection connection, UseLink use) {
        this.company = company; this.origin = origin; this.connection = connection; this.use = use;
    }

    /** The company list on SharedPreferences ('companies'; 'pairing' holds 0.3.x's single record to move and the gate). */
    static Companies companies(Context context, SharedPreferences pairing) {
        return new Companies(store(context.getSharedPreferences("companies", Context.MODE_PRIVATE)), store(pairing));
    }

    /** The local entrance's secret cookie value (one for all companies' origins), made once. */
    static String gate(SharedPreferences pairing) {
        String gate = pairing.getString("gate", "");
        if (gate.isEmpty()) { gate = Crypto.b64url(Crypto.random(24)); pairing.edit().putString("gate", gate).apply(); }
        return gate;
    }

    private static Companies.Store store(SharedPreferences prefs) {
        return new Companies.Store() {
            @Override public String get(String key) { return prefs.getString(key, null); }
            @Override public void put(String key, String value) { if (value == null) prefs.edit().remove(key).apply(); else prefs.edit().putString(key, value).apply(); }
        };
    }

    /** Starts the company's connection on its port (any free one when taken) and its phone-use socket. */
    static CompanyLink open(Context context, String company, PhoneConnection.Paired paired, int port, String gate, Events events) throws IOException {
        Context app = context.getApplicationContext();
        PhoneConnection[] self = new PhoneConnection[1];
        PhoneConnection connection = new PhoneConnection(paired, (text, connected) -> {
            PhoneConnection live = self[0];
            String pc = live == null ? null : live.pcName();
            int others = live == null ? 0 : live.linkedCount() - 1; // B-084 M1: the company's other PCs linked too
            KeepAlive.update(app, connected && pc != null ? "Connected to " + pc + (others > 0 ? " (+" + others + ")" : "") : "Reconnecting…");
            events.status(text, connected);
        });
        self[0] = connection;
        connection.onLinked(events::linked);
        String origin = connection.start(port, gate);
        UseLink use = new UseLink(app, origin, gate, paired.token, paired.deviceId, (pcs) -> {
            connection.updatePcs(pcs);
            events.pcs(company, connection.paired().pcs);
        });
        use.start();
        NetworkWake.register(app, connection);
        KeepAlive.update(app, "Connecting…");
        return new CompanyLink(company, origin, connection, use);
    }

    /** Ends the connection, the phone-use socket and the network callback's target. */
    void stop(Context context) {
        use.stop();
        connection.stop();
        NetworkWake.register(context, null);
    }

    /** The name of the PC the link goes to now, or null. */
    String pcName() { return connection.pcName(); }

    /** The PC picker: one row per PC; a pick puts that PC first (the link moves when it is online). */
    void pick(Activity activity, Events events) {
        List<PhoneConnection.Pc> pcs = connection.pcs();
        String now = connection.pcName() == null ? null : connection.pc();
        String[] rows = new String[pcs.size()];
        int checked = -1;
        for (int i = 0; i < rows.length; i++) {
            PhoneConnection.Pc pc = pcs.get(i);
            boolean here = pc.fingerprint.equals(now);
            if (here) checked = i;
            rows[i] = pc.name + (here ? " · connected" : connection.online(pc.fingerprint) ? " · online" : " · offline");
        }
        new AlertDialog.Builder(activity).setTitle("Connect through")
                .setSingleChoiceItems(rows, checked, (dialog, which) -> {
                    dialog.dismiss();
                    connection.prefer(pcs.get(which).fingerprint);
                    events.pcs(company, connection.paired().pcs);
                })
                .setNegativeButton("Cancel", null).show();
    }
}
