// Owns: the WebRTC way (F25 stage 2, 16.11.2026) of one PhoneConnection – at most one try or way, always to the page's
// PC and over its channel through the meeting server (A): step() starts a try when RtcPlan says so and ends a way whose
// PC or channel is no longer the page's; via() gives the page B while B carries, else A; the PC's rtc messages on A
// and A's end reach the way; a way's end tells the plan, ends B's streams and wakes the connection, whose next round
// puts the page back on A.
// Never: opens or picks a channel (PhoneConnection and PcLinks do), or tries without the plan.
package com.teydralab.autark.android.relay;

import java.util.Map;

final class PageRtc {
    /** The connection's side: B's stream messages and end go to its entrance; nudge() runs its loop now. */
    interface Host {
        void deliver(PeerChannel b, Map<String, Object> message);
        void channelClosed(PeerChannel b);
        void nudge();
    }

    private final RtcEngine engine;
    private final byte[] seed;
    private final String deviceId;
    private final Host host;
    private final RtcPlan plan = new RtcPlan();
    private volatile RtcWay way;

    PageRtc(RtcEngine engine, byte[] seed, String deviceId, Host host) {
        this.engine = engine; this.seed = seed; this.deviceId = deviceId; this.host = host;
    }

    /** The channel the page's streams take for its PC's channel `a`: B while B carries, else `a`. Never waits. */
    PeerChannel via(PeerChannel a) {
        RtcWay running = way;
        PeerChannel b = running == null || a == null || !running.on(a) ? null : running.carrying();
        return b != null && !b.isClosed() ? b : a;
    }

    /** After each round of the connection: `a` is the page's channel now (null: none), `pcKey` its PC's key. */
    void step(PeerChannel a, byte[] pcKey) {
        RtcWay running = way;
        if (running != null && !running.over()) {
            if (running.on(a)) return;
            running.close("moved");
        }
        if (a == null || pcKey == null || a.direct() || a.isClosed() || !plan.due(a, System.currentTimeMillis())) return;
        plan.started(a);
        way = RtcWay.start(a, engine, seed, deviceId, pcKey, owner);
    }

    /** An rtc message of the PC on channel `a`. */
    void signal(PeerChannel a, Map<String, Object> message) {
        RtcWay running = way;
        if (running != null && a != null && running.on(a)) running.signal(message);
    }

    /** Channel `a` closed: a way on it ends with it. */
    void closed(PeerChannel a) {
        RtcWay running = way;
        if (running != null && a != null && running.on(a)) running.close("closed");
    }

    /** The app came back or the network changed. */
    void check() { plan.check(); }

    /** Milliseconds until a lost way is due again. */
    long nextAgain(long now) { return plan.nextAgain(now); }

    void stop() {
        RtcWay running = way;
        if (running != null) running.close("closed");
    }

    private final RtcWay.Owner owner = new RtcWay.Owner() {
        @Override public void ready(RtcWay ready) { host.nudge(); } // the connection's next round moves the page onto B

        @Override public void message(RtcWay from, PeerChannel b, Map<String, Object> message) { host.deliver(b, message); }

        @Override public void over(RtcWay ended, String outcome, boolean wasReady) {
            plan.ended(ended.a(), outcome, wasReady, System.currentTimeMillis());
            PeerChannel b = ended.b();
            if (b != null) host.channelClosed(b); // its streams end; the next round puts the page back on A
            host.nudge();
        }
    };
}
