// Owns: one pairing with the PC under a Remote ID on its own thread, its texts on PairScreens' wait level ("Finding the
// PC…", then "Accept on <PC> if it shows the same code." with the 4-digit code) and, when it fails, the reason back on
// the level the ID came from. The finished pairing goes to the caller on the main thread. Never: stores the pairing,
// retries by itself, or reports anything after cancel().
package com.teydralab.autark.android.pair;

import android.app.Activity;
import android.os.Build;
import com.teydralab.autark.android.ConnectionAddress;
import com.teydralab.autark.android.relay.PhoneConnection;
import java.io.IOException;
import java.util.function.Consumer;

public final class PairRun {
    private PairRun() {}

    /** Starts the pairing; done gets the pairing on the main thread, or null when it failed (PairScreens then shows why). */
    public static PhoneConnection.Pairing start(Activity activity, String remoteId, Consumer<PhoneConnection.Paired> done) {
        PhoneConnection.Pairing running = new PhoneConnection.Pairing();
        PairScreens.status("Finding the PC through Autark's meeting server…");
        String name = (Build.MANUFACTURER + " " + Build.MODEL).trim();
        new Thread(() -> {
            PhoneConnection.Paired paired = null;
            String reason = null;
            try {
                paired = PhoneConnection.pair(ConnectionAddress.DEFAULT_RELAY, remoteId, name, running, (digits, pcName) ->
                        PairScreens.status("Accept on " + pcName + " if it shows the same code.\n" + digits));
            } catch (IOException error) {
                reason = error.getMessage() == null ? "Pairing failed." : error.getMessage();
            }
            PhoneConnection.Paired result = paired;
            String why = reason;
            activity.runOnUiThread(() -> {
                if (running.cancelled()) return;
                if (result == null) PairScreens.failed(why);
                done.accept(result);
            });
        }, "autark-pair").start();
        return running;
    }
}
