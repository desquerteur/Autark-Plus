// Owns: the stand-ins of the phone's WebRTC way tests (F25 stage 2; RtcWayTest, RtcInterop) – a finished channel A over
// an in-memory pipe to a stand-in PC that runs the real pinned handshake as the acceptor (devices/handshake.ts) and seals
// its JSON frames, a data channel as two RtcPipes back to back, a stand-in libwebrtc (RtcEngine) the test drives, and
// ears for what a way tells its connection.
// Never: a test of its own, or anything a phone's libwebrtc does.
package com.teydralab.autark.android.relay;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

final class RtcStandIns {
    static final byte[] PHONE_SEED = Crypto.newSeed();
    static final byte[] PC_SEED = Crypto.newSeed();
    static final byte[] PC_PUB = Crypto.ed25519Public(PC_SEED);
    /** Every line the stand-in libwebrtc was asked to log. */
    static final List<String> LOG = new CopyOnWriteArrayList<>();

    private RtcStandIns() {}

    static final String OFFER_SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n"
            + "a=ice-ufrag:abcd\r\na=ice-pwd:efghijklmnopqrstuvwxyz\r\na=fingerprint:sha-256 00:11\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n"
            + "a=candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host\r\na=candidate:2 1 udp 2122260223 127.0.0.1 50000 typ host\r\n";
    static final String ANSWER_SDP = "v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n"
            + "a=ice-ufrag:wxyz\r\na=ice-pwd:abcdefghijklmnopqrstuv\r\na=fingerprint:sha-256 22:33\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\n"
            + "a=candidate:7 1 udp 2122260223 192.168.1.30 40000 typ host\r\n";

    /** One way under test: A through an in-memory pipe to the stand-in PC, the stand-in libwebrtc, the owner's ears. */
    static final class Rig {
        final FakeEngine engine = new FakeEngine();
        final Ears owner = new Ears();
        final PeerChannel a;
        final FakePc pcA;
        final Mem wireA;
        FakePc pcB;
        RtcWay way;
        String id;

        Rig() throws Exception { this(true); }

        Rig(boolean start) throws Exception {
            Wired wired = wire(false);
            a = wired.channel; pcA = wired.pc; wireA = wired.phoneSide;
            if (start) wired.way = way = RtcWay.start(a, engine, PHONE_SEED, "dev_phone", PC_PUB, owner, 1_000, 3_000, 400);
        }

        static final class Wired { PeerChannel channel; FakePc pc; Mem phoneSide; volatile RtcWay way; }

        /** A finished channel (the pinned handshake done) over a pipe pair; `direct` as F29's socket would say. */
        static Wired wire(boolean direct) throws Exception {
            Mem phone = new Mem(direct), pc = new Mem(direct);
            phone.peer = pc; pc.peer = phone;
            Wired out = new Wired();
            out.pc = new FakePc(pc, PC_SEED, Crypto.ed25519Public(PHONE_SEED));
            out.channel = PeerChannel.connect(phone, PHONE_SEED, "dev_phone", PC_PUB, new PeerChannel.Listener() {
                @Override public void message(Map<String, Object> message) { RtcWay way = out.way; if (RtcSignal.mine(message) && way != null) way.signal(message); }
                @Override public void closed() { }
            });
            out.phoneSide = phone;
            return out;
        }

        String offer(List<Object> ice) throws Exception {
            id = "a1b2c3d4" + Long.toHexString(System.nanoTime());
            pcA.send(Json.map("t", "rtc", "v", 1, "op", "offer", "id", id, "sdp", OFFER_SDP, "ice", ice));
            return id;
        }

        List<String> candidates(int count) throws Exception {
            List<String> out = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                Map<String, Object> cand = pcA.next("cand");
                @SuppressWarnings("unchecked") Map<String, Object> c = (Map<String, Object>) cand.get("c");
                if (c == null) throw new AssertionError("a cand without a candidate (" + cand + ")");
                out.add((String) c.get("candidate"));
            }
            return out;
        }

        PeerChannel openB(Answer answer, byte[] pcSeed) throws Exception { return openB(answer, pcSeed, id, () -> way.carrying()); }

        /** The PC's data channel opens; the PC (key of `pcSeed`) runs its side of the handshake and says ready. */
        PeerChannel openB(Answer answer, byte[] pcSeed, String readyId, java.util.function.Supplier<PeerChannel> carrying) throws Exception {
            Back toPc = new Back(null);
            Back toPhone = new Back(answer.events);
            RtcPipe pcPipe = new RtcPipe(toPhone);
            toPc.target = pcPipe;
            FakePc b = new FakePc(pcPipe, pcSeed, Crypto.ed25519Public(PHONE_SEED));
            pcB = b;
            answer.events.open("autark", toPc);
            if (!b.authed(2_000)) return null;
            b.send(Json.map("t", "rtc", "v", 1, "op", "ready", "id", readyId));
            for (int i = 0; i < 100 && carrying.get() == null; i++) Thread.sleep(10);
            return carrying.get();
        }
    }

    /** One end of an in-memory pipe; frames reach the other end on a thread of their own, in order. */
    static final class Mem implements Pipe {
        final boolean direct;
        final ExecutorService out = Executors.newSingleThreadExecutor((task) -> { Thread t = new Thread(task, "mem-pipe"); t.setDaemon(true); return t; });
        final List<String> clear = new CopyOnWriteArrayList<>();
        Mem peer;
        volatile Pipe.Listener listener;
        volatile boolean closed;
        Mem(boolean direct) { this.direct = direct; }
        @Override public void listen(Pipe.Listener listener) { this.listener = listener; }
        @Override public boolean isClosed() { return closed; }
        @Override public void sendText(String text) { clear.add(text); deliver(text.getBytes(StandardCharsets.UTF_8), true); }
        @Override public void sendBinary(byte[] data) { clear.add(new String(data, StandardCharsets.ISO_8859_1)); deliver(data, false); }
        @Override public boolean direct() { return direct; }
        private void deliver(byte[] data, boolean text) { if (!closed) out.execute(() -> { Pipe.Listener target = peer.listener; if (target != null) target.message(data, text); }); }
        @Override public void close() { if (closed) return; closed = true; Pipe.Listener mine = listener; if (mine != null) mine.closed(); peer.close(); }
        /** Nothing the phone sent was readable: no rtc, SDP, candidate or address. */
        boolean plainFree() {
            for (String frame : clear) if (frame.contains("rtc") || frame.contains("sdp") || frame.contains("candidate") || frame.contains("192.168.") || frame.contains("ufrag")) return false;
            return true;
        }
    }

    /** A data channel's one direction: the phone's RtcPipe sends to the PC's, the PC's back into the engine's events. */
    static final class Back implements RtcPipe.Wire {
        volatile RtcPipe target;
        final RtcEngine.Events events;
        final ExecutorService out = Executors.newSingleThreadExecutor((task) -> { Thread t = new Thread(task, "mem-dc"); t.setDaemon(true); return t; });
        volatile boolean closed;
        Back(RtcEngine.Events events) { this.events = events; }
        @Override public boolean send(byte[] data, boolean text) {
            if (closed) return false;
            out.execute(() -> { if (events != null) events.message(data, text); else if (target != null) target.receive(data, text); });
            return true;
        }
        @Override public long buffered() { return 0; }
        @Override public void close() { closed = true; }
    }

    /** The PC's side of the pinned handshake (devices/handshake.ts as the acceptor) and its sealed JSON frames. */
    static final class FakePc implements Pipe.Listener {
        final Pipe pipe;
        final byte[] seed;
        final byte[] pub;
        final byte[] phonePub;
        final BlockingQueue<Map<String, Object>> inbox = new LinkedBlockingQueue<>();
        final java.util.concurrent.CountDownLatch auth = new java.util.concurrent.CountDownLatch(1);
        byte[] hash, sendKey, receiveKey;
        long sent, received = -1;

        FakePc(Pipe pipe, byte[] seed, byte[] phonePub) { this.pipe = pipe; this.seed = seed; this.pub = Crypto.ed25519Public(seed); this.phonePub = phonePub; pipe.listen(this); }

        @Override public synchronized void message(byte[] data, boolean text) {
            if (text) {
                Map<String, Object> m = Json.object(new String(data, StandardCharsets.UTF_8));
                if ("hello".equals(m.get("t"))) {
                    byte[] phone = Crypto.fromB64url(Json.str(m, "pub"));
                    if (!Arrays.equals(phone, phonePub)) { pipe.close(); return; }
                    byte[][] mine = Crypto.x25519Pair();
                    hash = Crypto.sha256(Crypto.concat(Crypto.utf8("wf-peer-v1"), phone, Crypto.fromB64url(Json.str(m, "eph")), Crypto.fromB64url(Json.str(m, "n")), pub, mine[1]));
                    byte[] okm = Crypto.hkdf(Crypto.x25519(mine[0], Crypto.fromB64url(Json.str(m, "eph"))), hash, "wf-peer-v1 keys", 64);
                    receiveKey = Arrays.copyOfRange(okm, 0, 32);
                    sendKey = Arrays.copyOfRange(okm, 32, 64);
                    pipe.sendText(Json.write(Json.map("t", "welcome", "v", 1, "id", "dev_pc", "pub", Crypto.b64url(pub), "eph", Crypto.b64url(mine[1]), "sig", Crypto.b64url(Crypto.sign(seed, Crypto.concat(Crypto.utf8("server"), hash))))));
                } else if ("auth".equals(m.get("t")) && Crypto.verify(phonePub, Crypto.concat(Crypto.utf8("client"), hash), Crypto.fromB64url(Json.str(m, "sig")))) auth.countDown();
                return;
            }
            long counter = 0;
            for (int i = 0; i < 8; i++) counter = (counter << 8) | (data[i] & 0xff);
            byte[] plain = counter > received ? Crypto.open(receiveKey, counter, data, 8, data.length - 8) : null;
            if (plain == null) { pipe.close(); return; }
            received = counter;
            inbox.offer(Json.object(new String(plain, StandardCharsets.UTF_8)));
        }

        @Override public void closed() { }

        boolean authed(long ms) throws InterruptedException { return auth.await(ms, TimeUnit.MILLISECONDS); }

        synchronized void send(Map<String, Object> message) throws Exception {
            if (!authed(2_000)) throw new IOException("no handshake");
            byte[] body = Crypto.seal(sendKey, sent, Json.write(message).getBytes(StandardCharsets.UTF_8));
            byte[] frame = new byte[8 + body.length];
            for (int i = 0; i < 8; i++) frame[i] = (byte) (sent >>> (56 - 8 * i));
            System.arraycopy(body, 0, frame, 8, body.length);
            sent++;
            pipe.sendBinary(frame);
        }

        /** The next message (of rtc op `op`, others skipped; null: any), within 5 s. */
        Map<String, Object> next(String op) throws Exception {
            long deadline = System.currentTimeMillis() + 5_000;
            for (;;) {
                Map<String, Object> m = inbox.poll(Math.max(1, deadline - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                if (m == null) throw new AssertionError("no " + op + " from the phone");
                if (op == null || op.equals(m.get("op"))) return m;
            }
        }

        /** No message (of rtc op `op`; null: none at all) arrives within 300 ms. */
        boolean quiet(String op) throws InterruptedException {
            long deadline = System.currentTimeMillis() + 300;
            for (;;) {
                long left = deadline - System.currentTimeMillis();
                Map<String, Object> m = left <= 0 ? null : inbox.poll(left, TimeUnit.MILLISECONDS);
                if (m == null) return true;
                if (op == null || op.equals(m.get("op"))) return false;
            }
        }
    }

    static final class Answer {
        String offer;
        List<String> stun;
        RtcEngine.Events events;
        FakePeer peer;
    }

    static final class FakePeer implements RtcEngine.Peer {
        final String sdp;
        volatile boolean closed;
        FakePeer(String sdp) { this.sdp = sdp; }
        @Override public String sdp() { return sdp; }
        @Override public void close() { closed = true; }
    }

    static final class FakeEngine implements RtcEngine {
        final BlockingQueue<Answer> answers = new LinkedBlockingQueue<>();
        volatile String answerSdp = ANSWER_SDP;
        volatile boolean missing;
        volatile int calls;
        @Override public String net() { return "wifi"; }
        @Override public Peer answer(String offer, List<String> stun, Events events) throws IOException {
            calls++;
            if (missing) throw new IOException("WebRTC is not available on this phone.");
            Answer answer = new Answer();
            answer.offer = offer; answer.stun = stun; answer.events = events; answer.peer = new FakePeer(answerSdp);
            answers.offer(answer);
            return answer.peer;
        }
        @Override public void log(String line) { LOG.add(line); }
        Answer next() throws InterruptedException {
            Answer answer = answers.poll(2, TimeUnit.SECONDS);
            if (answer == null) throw new AssertionError("libwebrtc was not asked");
            return answer;
        }
    }

    static final class Over { String outcome; boolean wasReady; }

    static final class Ears implements RtcWay.Owner {
        final BlockingQueue<RtcWay> readies = new LinkedBlockingQueue<>();
        final BlockingQueue<Map<String, Object>> messages = new LinkedBlockingQueue<>();
        final BlockingQueue<Over> overs = new LinkedBlockingQueue<>();
        @Override public void ready(RtcWay way) { readies.offer(way); }
        @Override public void message(RtcWay way, PeerChannel b, Map<String, Object> message) { messages.offer(message); }
        @Override public void over(RtcWay way, String outcome, boolean wasReady) { Over o = new Over(); o.outcome = outcome; o.wasReady = wasReady; overs.offer(o); }
        Over over() throws InterruptedException { return over(3); }
        Over over(int seconds) throws InterruptedException {
            Over o = overs.poll(seconds + 3, TimeUnit.SECONDS);
            if (o == null) throw new AssertionError("the way did not end");
            return o;
        }
    }
}
