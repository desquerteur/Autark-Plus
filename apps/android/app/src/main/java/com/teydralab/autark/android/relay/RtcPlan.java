// Owns: when the phone tries the WebRTC way to its page's PC (F25 stage 2, 16.11.2026) – sparing the battery: one try per
// tunnel channel to that PC, and one more after each check() (the app came back, the network changed); a try that fails
// waits for the next of those, never for a timer. A way that carried the page and then ended is tried again after
// 30 s, 2 min, then 10 min (check() starts that over). A PC that says no (off, another version), that never answers a
// hello (an older PC) or that ends the try before any offer (it could not guard its WebRTC) gets no further try on that
// channel; a refusal of this phone's key on the data channel ends the tries for the whole connection.
// Never: starts a try itself (PhoneConnection does), keeps a timer, or knows a PC beyond its channel.
package com.teydralab.autark.android.relay;

final class RtcPlan {
    static final long[] AGAIN_MS = { 30_000, 120_000, 600_000 };

    private boolean refused;
    private Object triedOn;
    private Object declinedOn;
    private boolean checked;
    private long againAt;
    private int lost;

    /** True when a try on channel `a` (the page's tunnel channel) is due now. */
    synchronized boolean due(Object a, long now) {
        if (refused || a == null || a == declinedOn) return false;
        if (a != triedOn || checked) return true;
        return againAt != 0 && now >= againAt;
    }

    /** A try started on `a`. */
    synchronized void started(Object a) {
        triedOn = a;
        checked = false;
        againAt = 0;
    }

    /** The try or way on `a` ended with `outcome` (RtcWay's words); `wasReady` when it had carried the page. */
    synchronized void ended(Object a, String outcome, boolean wasReady, long now) {
        if ("refused".equals(outcome)) { refused = true; return; }
        if ("off".equals(outcome) || "version".equals(outcome) || "old".equals(outcome) || "nooffer".equals(outcome)) { declinedOn = a; return; }
        if (wasReady && a == triedOn) againAt = now + AGAIN_MS[Math.min(lost++, AGAIN_MS.length - 1)];
    }

    /** The app came back or the network changed: one more try is due, and a lost way's pause starts over. */
    synchronized void check() {
        checked = true;
        lost = 0;
    }

    /** Milliseconds until a lost way is tried again (Long.MAX_VALUE: nothing waits). */
    synchronized long nextAgain(long now) {
        return againAt == 0 || refused ? Long.MAX_VALUE : Math.max(0, againAt - now);
    }
}
