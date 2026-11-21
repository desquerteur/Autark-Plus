// Owns: one try of the WebRTC way to the page's PC and, once it stands, that way (F25 stage 2, 16.11.2026; the PC's end
// is rendezvous/rtc.ts). All of it is said inside channel A only – a PeerChannel exists only after its pinned handshake,
// so nothing goes out before A is finished, and every message is sealed with A's session keys: hello {net}; the PC's
// offer (its SDP with the PC's candidates through RtcSignal's filter, and its STUN list – exactly what libwebrtc gets as
// ICE servers; an empty list stays empty) or no {why}; the answer (≤ 16 KiB) with this phone's candidates as cand
// messages through the same filter (UDP, ≤ 32), then done; end either way. When the PC's data channel "autark" opens,
// the pinned handshake runs again over it (RtcPipe, PeerChannel.connect with this phone's key; the PC must prove its own
// key once more – DTLS is only the wrapper); the PC's ready {id} on that channel (B) makes it the page's channel. It
// ends – and the page is back on A at once – when the PC says end, the data channel closes, ICE fails or stays
// disconnected for 5 s, B breaks, or nothing comes: 5 s without an answer to hello (an older PC), 15 s from the offer to
// ready. A log line per try carries the outcome, the time and the candidate types, never an address.
// Never: opens A, decides when to try (RtcPlan) or which channel the page uses (PhoneConnection), or tries again itself.
package com.teydralab.autark.android.relay;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class RtcWay {
    /** What the way tells its connection: ready and over on a thread of their own, B's messages in order on B's reader. */
    interface Owner {
        void ready(RtcWay way);
        void message(RtcWay way, PeerChannel b, Map<String, Object> message);
        void over(RtcWay way, String outcome, boolean wasReady);
    }

    static final long HELLO_MS = 5_000;
    static final long TRY_MS = 15_000;
    static final long LOST_MS = 5_000;
    private static final Set<String> NO = new HashSet<>(java.util.Arrays.asList("off", "busy", "full", "refused", "version", "later"));
    private static final Set<String> ENDS = new HashSet<>(java.util.Arrays.asList("timeout", "failed", "refused", "lost", "closed"));
    /** Messages on A and the owner's calls, in order and off every caller's lock. */
    private static final ExecutorService OUT = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "autark-rtc");
        thread.setDaemon(true);
        return thread;
    });

    private enum State { HELLO, ANSWERING, TRYING, SHAKING, READY, OVER }

    private final PeerChannel a;
    private final RtcEngine engine;
    private final byte[] seed;
    private final String deviceId;
    private final byte[] pcKey;
    private final Owner owner;
    private final long helloMs;
    private final long tryMs;
    private final long lostMs;
    private final long started = System.currentTimeMillis();
    private final List<String> early = new ArrayList<>();
    private final Set<String> sent = new HashSet<>();
    private State state = State.HELLO;
    private String id;
    private String net;
    private RtcEngine.Peer peer;
    private RtcPipe pipe;
    private PeerChannel b;
    private volatile PeerChannel readyB;
    private boolean readySeen;
    private boolean gathered;
    private boolean done;
    private int dropped;
    private String local;
    private String remote;
    private ScheduledFuture<?> timer;
    private ScheduledFuture<?> lost;

    private RtcWay(PeerChannel a, RtcEngine engine, byte[] seed, String deviceId, byte[] pcKey, Owner owner, long helloMs, long tryMs, long lostMs) {
        this.a = a; this.engine = engine; this.seed = seed; this.deviceId = deviceId; this.pcKey = pcKey; this.owner = owner;
        this.helloMs = helloMs; this.tryMs = tryMs; this.lostMs = lostMs;
    }

    /** Starts a try on `a` (the page's finished channel through the meeting server): hello goes out now. */
    static RtcWay start(PeerChannel a, RtcEngine engine, byte[] seed, String deviceId, byte[] pcKey, Owner owner) {
        return start(a, engine, seed, deviceId, pcKey, owner, HELLO_MS, TRY_MS, LOST_MS);
    }

    static RtcWay start(PeerChannel a, RtcEngine engine, byte[] seed, String deviceId, byte[] pcKey, Owner owner, long helloMs, long tryMs, long lostMs) {
        RtcWay way = new RtcWay(a, engine, seed, deviceId, pcKey, owner, helloMs, tryMs, lostMs);
        synchronized (way) {
            way.net = engine.net();
            way.say(RtcSignal.hello(way.net));
            way.timer = way.later(helloMs, "old");
        }
        return way;
    }

    /** True when this way signals on `channel`. */
    boolean on(PeerChannel channel) { return channel == a; }

    /** The channel it signals on. */
    PeerChannel a() { return a; }

    /** B while it carries the page (after ready, until the way ends), else null. Never waits. */
    PeerChannel carrying() { return readyB; }

    /** B once its handshake is done (also after the way ended), else null. */
    synchronized PeerChannel b() { return b; }

    synchronized boolean over() { return state == State.OVER; }

    /** The connection ends it (another PC, A closed, stop): the PC hears end while A is open. */
    synchronized void close(String why) { over(why, true); }

    /** An rtc message of the PC on A (A's reader thread). */
    void signal(Map<String, Object> message) {
        String op = Json.str(message, "op");
        synchronized (this) {
            if (state == State.OVER) return;
            if (state == State.HELLO) {
                if ("no".equals(op)) { String why = Json.str(message, "why"); over(why != null && NO.contains(why) ? why : "no", false); return; }
                if ("end".equals(op)) { over("nooffer", false); return; } // the PC could not offer (fail-closed): this channel says no
                if (!"offer".equals(op)) return;
                RtcSignal.Offer offer = RtcSignal.offer(message);
                if (offer == null) {
                    String named = Json.str(message, "id");
                    if (named != null && !named.isEmpty() && named.length() <= 64) id = named; // the PC hears why its try ends
                    over("failed", true);
                    return;
                }
                id = offer.id;
                dropped += offer.dropped;
                state = State.ANSWERING;
                cancel(timer);
                timer = later(tryMs, "timeout");
                Thread answering = new Thread(() -> answer(offer), "autark-rtc-answer");
                answering.setDaemon(true);
                answering.start();
                return;
            }
            if (!"end".equals(op) || !id.equals(Json.str(message, "id"))) return;
            String why = Json.str(message, "why");
            over(state == State.READY && !"refused".equals(why) ? "lost" : why != null && ENDS.contains(why) ? why : "failed", false);
        }
    }

    /** libwebrtc takes the offer and answers it (a thread of its own: the engine may take a moment). */
    private void answer(RtcSignal.Offer offer) {
        RtcEngine.Peer made;
        try { made = engine.answer(offer.sdp, offer.stun, events); }
        catch (IOException | RuntimeException | LinkageError error) { synchronized (this) { over("failed", true); } return; }
        synchronized (this) {
            if (state != State.ANSWERING) { made.close(); return; }
            peer = made;
            String sdp = made.sdp();
            String description = sdp == null ? null : RtcSignal.withoutCandidates(sdp);
            if (description == null || RtcSignal.bytes(description) > RtcSignal.MAX_SDP) { over("failed", true); return; }
            say(RtcSignal.answer(id, description));
            state = State.TRYING;
            for (String line : RtcSignal.candidates(sdp)) own(line);
            for (String line : early) own(line);
            early.clear();
            if (gathered) finishCandidates();
        }
    }

    /** One of this phone's candidates goes to the PC when the filter passes it, at most 32, each once. */
    private void own(String line) {
        String bare = line.startsWith("a=") ? line.substring(2) : line;
        if (sent.contains(bare)) return;
        if (sent.size() >= RtcSignal.MAX_CANDIDATES || RtcSignal.candidateType(bare) == null) { dropped++; return; }
        sent.add(bare);
        say(RtcSignal.candidate(id, bare));
    }

    private void finishCandidates() {
        if (done) return;
        done = true;
        say(RtcSignal.done(id));
    }

    private final RtcEngine.Events events = new RtcEngine.Events() {
        @Override public void candidate(String line) {
            synchronized (RtcWay.this) {
                if (state == State.ANSWERING) early.add(line);
                else if (state == State.TRYING || state == State.SHAKING) own(line);
            }
        }

        @Override public void gathered() {
            synchronized (RtcWay.this) {
                gathered = true;
                if (state == State.TRYING || state == State.SHAKING) finishCandidates();
            }
        }

        @Override public void ice(String ice) {
            synchronized (RtcWay.this) {
                if (state == State.OVER) return;
                if ("failed".equals(ice) || "closed".equals(ice)) over(state == State.READY ? "lost" : "failed", true);
                else if ("disconnected".equals(ice)) { if (lost == null) lost = later(lostMs, null); }
                else if ("connected".equals(ice) || "completed".equals(ice)) { cancel(lost); lost = null; }
            }
        }

        @Override public void open(String label, RtcPipe.Wire wire) {
            RtcPipe opened;
            synchronized (RtcWay.this) {
                if (state != State.TRYING || pipe != null || !"autark".equals(label)) { wire.close(); return; }
                opened = pipe = new RtcPipe(wire);
                state = State.SHAKING;
            }
            Thread shake = new Thread(() -> handshake(opened), "autark-rtc-handshake");
            shake.setDaemon(true);
            shake.start();
        }

        @Override public void message(byte[] data, boolean text) {
            RtcPipe current;
            synchronized (RtcWay.this) { current = pipe; }
            if (current != null) current.receive(data, text);
        }

        @Override public void closed() {
            RtcPipe current;
            synchronized (RtcWay.this) { current = pipe; }
            if (current != null) current.ended(); // B's channel closes: the way ends through B's listener (or the handshake fails)
        }

        @Override public void pair(String localType, String remoteType) {
            synchronized (RtcWay.this) { local = type(localType); remote = type(remoteType); }
        }
    };

    /** The pinned handshake again, over the data channel, with this phone's key; the PC must prove the key it has on A. */
    private void handshake(RtcPipe opened) {
        PeerChannel channel;
        try { channel = PeerChannel.connect(opened, seed, deviceId, pcKey, onB); }
        catch (IOException | RuntimeException error) { synchronized (this) { over("failed", true); } return; }
        synchronized (this) {
            if (state != State.SHAKING) { channel.close(); return; }
            b = channel;
            if (readySeen) ready();
        }
    }

    private final PeerChannel.Listener onB = new PeerChannel.Listener() {
        @Override public void message(Map<String, Object> message) {
            if (RtcSignal.mine(message)) {
                if (!"ready".equals(message.get("op"))) return;
                synchronized (RtcWay.this) {
                    if (state != State.SHAKING || !id.equals(Json.str(message, "id"))) return;
                    readySeen = true;
                    if (b != null) ready();
                }
                return;
            }
            PeerChannel carrying = readyB;
            if (carrying != null) owner.message(RtcWay.this, carrying, message);
        }

        @Override public void closed() {
            synchronized (RtcWay.this) { over(state == State.READY ? "lost" : "failed", true); }
        }
    };

    /** The PC said ready on B and the handshake is done: B carries the page from now. */
    private void ready() {
        state = State.READY;
        cancel(timer);
        readyB = b;
        engine.log(line("ok", false));
        OUT.execute(() -> owner.ready(this));
    }

    /** Ends the try or way (the lock held): the PC hears end (`tell`, while A is open), B and the peer close. */
    private void over(String outcome, boolean tell) {
        if (state == State.OVER) return;
        boolean wasReady = state == State.READY;
        state = State.OVER;
        readyB = null;
        cancel(timer);
        cancel(lost);
        if (tell && id != null) say(RtcSignal.end(id, outcome));
        if (b != null) b.close();
        else if (pipe != null) pipe.close();
        if (peer != null) peer.close();
        engine.log(line(outcome, wasReady));
        OUT.execute(() -> owner.over(this, outcome, wasReady));
    }

    private String line(String outcome, boolean wasReady) {
        return "rtc " + (wasReady ? "ended " : "") + outcome + " ms=" + (System.currentTimeMillis() - started)
                + (local != null ? " local=" + local + " remote=" + remote : "") + " dropped=" + dropped + (net != null ? " net=" + net : "");
    }

    /** A candidate type for the log, never anything else. */
    private static String type(String value) { return value != null && value.matches("host|srflx|prflx|relay") ? value : "other"; }

    private void say(Map<String, Object> message) {
        OUT.execute(() -> { try { a.send(message); } catch (RuntimeException ignored) { /* A ends on its own */ } });
    }

    /** `outcome` after `ms` unless the state moved past it ("old": still no answer to hello; "timeout": not ready yet);
     *  null: ICE stayed disconnected. */
    private ScheduledFuture<?> later(long ms, String outcome) {
        return RelayLink.LATER.schedule(() -> {
            synchronized (this) {
                if (state == State.OVER) return;
                if (outcome == null) over(state == State.READY ? "lost" : "failed", true);
                else if ("old".equals(outcome) ? state == State.HELLO : state != State.READY) over(outcome, true);
            }
        }, ms, TimeUnit.MILLISECONDS);
    }

    private static void cancel(ScheduledFuture<?> task) { if (task != null) task.cancel(false); }
}
