// Owns: the phone's WebRTC way end to end against the PC's real code (F25 stage 2): this Java phone – PeerChannel A over
// a stand-in tunnel, RtcWay, RtcPipe, the pinned handshake on B – talks to the desktop's PhoneBridge and PhoneRtc
// (werift, rtc-socket.ts) in test/interop/rtc-pc.mjs, with real ICE, DTLS and SCTP between two werift stacks on this
// PC's own network addresses; only the phone's libwebrtc is played by werift there. Runs: ok – ready, then streams over
// B (a page, 1 MiB down, 300 KB up, checked by SHA-256), the PC counts them as rtc and logs ok with candidate types, A
// carries nothing readable; then the phone's peer goes away and the PC's end puts the page back on A, which still
// serves. off – the PC says no {off}. blocked – ICE never connects, the PC ends the try (timeout), A still serves.
// Run: build the host tests (test.ps1), then java -cp <host-tests;libs> com.teydralab.autark.android.relay.RtcInterop
// <apps/android/test/interop/rtc-pc.mjs> (Node 24 and apps/desktop's node_modules).
// Never: libwebrtc itself, a phone's networks, STUN, or a claim about speed on a phone.
package com.teydralab.autark.android.relay;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

public final class RtcInterop {
    private static int assertions;
    private static final Pattern ADDRESS = Pattern.compile("\\b\\d{1,3}(\\.\\d{1,3}){3}\\b");

    public static void main(String[] args) throws Exception {
        String script = args.length > 0 ? args[0] : "test/interop/rtc-pc.mjs";
        ok(script);
        off(script);
        blocked(script);
        System.out.println(assertions + " rtc interop assertions passed (the PC's real PhoneBridge, PhoneRtc and werift).");
        System.exit(0);
    }

    private static void ok(String script) throws Exception {
        try (Pc pc = new Pc(script, "ok")) {
            RtcWay way = pc.start();
            check(pc.owner.readies.poll(20, TimeUnit.SECONDS) == way, "ready on B from the PC's real PhoneRtc");
            PeerChannel b = way.carrying();
            check(b != null && b.direct(), "B carries the page");
            check(pc.get(b, 1, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").endsWith("hello phone"), "a page over B");
            long start = System.currentTimeMillis();
            byte[] big = pc.getBytes(b, 2, "GET /big HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            long ms = Math.max(1, System.currentTimeMillis() - start);
            boolean exact = big.length == 1024 * 1024;
            for (int i = 0; exact && i < big.length; i++) exact = (big[i] & 0xff) == i % 251;
            check(exact, "1 MiB down over B, every byte right (" + big.length + " bytes, " + (big.length / 1024 * 1000 / ms) + " KiB/s in this run)");
            byte[] body = new byte[300_000];
            new java.util.Random(7).nextBytes(body);
            String head = "POST /up HTTP/1.1\r\nHost: x\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
            String answer = pc.post(b, 3, head, body);
            check(answer.endsWith("got 300000 " + Crypto.hex(Crypto.sha256(body))), "300 KB up over B, the PC's runtime saw every byte (" + answer.substring(Math.max(0, answer.length() - 80)) + ")");
            Map<String, Object> logs = pc.logs();
            String text = Json.write(logs);
            check(text.contains("\"outcome\":\"ok\"") && text.contains("\"local\":\"host\""), "the PC logged ok with candidate types (" + text + ")");
            @SuppressWarnings("unchecked") List<Object> counts = (List<Object>) logs.get("counts");
            @SuppressWarnings("unchecked") Map<String, Object> count = (Map<String, Object>) counts.get(0);
            check(Json.num(count, "rtc", 0) > 1_300_000 && "rtc".equals(count.get("via")) && Json.num(count, "relay", 0) < 200_000, "the PC counts the streams as rtc, the tunnel kept little (" + count + ")");
            check(pc.aFramesPlain().isEmpty(), "A's bytes carried no SDP, candidate or ICE data in the clear");
            pc.send(Json.map("k", "close")); // the phone's peer goes away (network gone)
            RtcStandIns.Over over = pc.owner.over(20);
            check(over.outcome.equals("lost") && over.wasReady && way.carrying() == null, "the way ends (" + over.outcome + "): back on A");
            check(pc.get(pc.a, 9, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").endsWith("hello phone"), "A still serves");
            for (String line : pc.engine.log) check(!ADDRESS.matcher(line).find(), "the phone's log line has no address: " + line);
            System.out.println("  phone log: " + pc.engine.log);
        }
    }

    private static void off(String script) throws Exception {
        try (Pc pc = new Pc(script, "off")) {
            pc.start();
            check(pc.owner.over(10).outcome.equals("off"), "devices.rtc off at the PC: no {off}");
            check(pc.get(pc.a, 1, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").endsWith("hello phone"), "the tunnel serves");
        }
    }

    private static void blocked(String script) throws Exception {
        try (Pc pc = new Pc(script, "blocked")) {
            pc.start();
            RtcStandIns.Over over = pc.owner.over(20);
            check(over.outcome.equals("timeout") || over.outcome.equals("failed"), "ICE never connects: the try ends (" + over.outcome + ")");
            check(pc.get(pc.a, 1, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").endsWith("hello phone"), "the tunnel serves on");
        }
    }

    /** The PC process: A over its stdio, the stand-in libwebrtc as a werift peer in it. */
    static final class Pc implements AutoCloseable, RtcEngine {
        final Process process;
        final OutputStream in;
        final byte[] seed = Crypto.newSeed();
        final RtcStandIns.Ears owner = new RtcStandIns.Ears();
        final StdioPipe pipe = new StdioPipe();
        final BlockingQueue<Map<String, Object>> replies = new LinkedBlockingQueue<>();
        final Map<PeerChannel, Map<Long, BlockingQueue<Map<String, Object>>>> streams = new ConcurrentHashMap<>();
        final List<byte[]> aFrames = new CopyOnWriteArrayList<>();
        final Pc engine = this;
        final List<String> log = new CopyOnWriteArrayList<>();
        volatile RtcEngine.Events events;
        volatile RtcWay way;
        PeerChannel a;
        byte[] pcPub;

        Pc(String script, String mode) throws Exception {
            process = new ProcessBuilder("node", script, Crypto.b64url(Crypto.ed25519Public(seed)), mode).redirectError(ProcessBuilder.Redirect.INHERIT).start();
            in = process.getOutputStream();
            Thread reader = new Thread(this::read, "pc-reader");
            reader.setDaemon(true);
            reader.start();
            Map<String, Object> hello = reply("pc", 30);
            pcPub = Crypto.fromB64url(Json.str(hello, "pub"));
        }

        /** A (the pinned handshake over the stand-in tunnel), then a try on it. */
        RtcWay start() throws IOException {
            a = PeerChannel.connect(pipe, seed, "dev_phone", pcPub, new PeerChannel.Listener() {
                @Override public void message(Map<String, Object> message) {
                    if (RtcSignal.mine(message)) { RtcWay running = way; if (running != null) running.signal(message); }
                    else stream(a, message);
                }
                @Override public void closed() { }
            });
            RtcWay.Owner relay = new RtcWay.Owner() {
                @Override public void ready(RtcWay w) { owner.ready(w); }
                @Override public void message(RtcWay w, PeerChannel b, Map<String, Object> message) { stream(b, message); }
                @Override public void over(RtcWay w, String outcome, boolean wasReady) { owner.over(w, outcome, wasReady); }
            };
            way = RtcWay.start(a, this, seed, "dev_phone", pcPub, relay);
            return way;
        }

        void stream(PeerChannel channel, Map<String, Object> message) {
            long s = Json.num(message, "s", -1);
            streams.computeIfAbsent(channel, (k) -> new ConcurrentHashMap<>()).computeIfAbsent(s, (k) -> new LinkedBlockingQueue<>()).offer(message);
        }

        String get(PeerChannel channel, long s, String request) throws Exception { return new String(getBytesRaw(channel, s, request.getBytes(StandardCharsets.ISO_8859_1)), StandardCharsets.ISO_8859_1); }

        String post(PeerChannel channel, long s, String head, byte[] body) throws Exception {
            byte[] all = new byte[head.length() + body.length];
            System.arraycopy(head.getBytes(StandardCharsets.ISO_8859_1), 0, all, 0, head.length());
            System.arraycopy(body, 0, all, head.length(), body.length);
            return new String(getBytesRaw(channel, s, all), StandardCharsets.ISO_8859_1);
        }

        /** The response body only. */
        byte[] getBytes(PeerChannel channel, long s, String request) throws Exception {
            byte[] raw = getBytesRaw(channel, s, request.getBytes(StandardCharsets.ISO_8859_1));
            String text = new String(raw, StandardCharsets.ISO_8859_1);
            int split = text.indexOf("\r\n\r\n");
            return java.util.Arrays.copyOfRange(raw, split + 4, raw.length);
        }

        /** One stream as StreamProxy runs it: o, the request in d pieces of 32 KiB, every d from the PC acknowledged, until e. */
        byte[] getBytesRaw(PeerChannel channel, long s, byte[] request) throws Exception {
            BlockingQueue<Map<String, Object>> inbox = streams.computeIfAbsent(channel, (k) -> new ConcurrentHashMap<>()).computeIfAbsent(s, (k) -> new LinkedBlockingQueue<>());
            channel.send(Json.map("t", "o", "s", s));
            for (int at = 0; at < request.length; at += 32 * 1024) {
                byte[] piece = java.util.Arrays.copyOfRange(request, at, Math.min(request.length, at + 32 * 1024));
                channel.send(Json.map("t", "d", "s", s, "b", Base64.getEncoder().encodeToString(piece)));
            }
            java.io.ByteArrayOutputStream got = new java.io.ByteArrayOutputStream();
            for (;;) {
                Map<String, Object> m = inbox.poll(30, TimeUnit.SECONDS);
                if (m == null) throw new AssertionError("stream " + s + " stalled after " + got.size() + " bytes");
                if ("d".equals(m.get("t"))) {
                    byte[] data = Base64.getDecoder().decode(Json.str(m, "b"));
                    got.write(data);
                    channel.send(Json.map("t", "a", "s", s, "n", data.length));
                } else if ("e".equals(m.get("t"))) return got.toByteArray();
            }
        }

        Map<String, Object> logs() throws Exception { send(Json.map("k", "logs")); return reply("logs", 10); }

        /** A's frames from the phone and the PC that show something of the WebRTC way in the clear. */
        List<String> aFramesPlain() {
            List<String> out = new ArrayList<>();
            for (byte[] frame : aFrames) {
                String text = new String(frame, StandardCharsets.ISO_8859_1);
                for (String word : new String[] { "candidate", "ice-ufrag", "fingerprint", "v=0", "\"rtc\"", "sdp" }) if (text.contains(word)) out.add(word);
            }
            return out;
        }

        void send(Map<String, Object> message) {
            byte[] line = (Json.write(message) + "\n").getBytes(StandardCharsets.UTF_8);
            synchronized (in) { try { in.write(line); in.flush(); } catch (IOException gone) { /* the process ended */ } }
        }

        Map<String, Object> reply(String kind, int seconds) throws Exception {
            long deadline = System.currentTimeMillis() + seconds * 1000L;
            for (;;) {
                Map<String, Object> m = replies.poll(Math.max(1, deadline - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                if (m == null) throw new AssertionError("no " + kind + " from the PC process");
                if (kind.equals(m.get("k"))) return m;
            }
        }

        private void read() {
            try (BufferedReader lines = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = lines.readLine()) != null;) {
                    Map<String, Object> m = Json.object(line);
                    String k = Json.str(m, "k");
                    RtcEngine.Events on = events;
                    switch (k) {
                        case "a": { byte[] data = Base64.getDecoder().decode(Json.str(m, "d")); boolean text = Boolean.TRUE.equals(m.get("t")); aFrames.add(data); Pipe.Listener target = pipe.listener; if (target != null) target.message(data, text); break; }
                        case "aclose": pipe.ended(); break;
                        case "cand": if (on != null) on.candidate(Json.str(m, "line")); break;
                        case "gathered": if (on != null) on.gathered(); break;
                        case "ice": if (on != null) on.ice(Json.str(m, "state")); break;
                        case "open": if (on != null) on.open(Json.str(m, "label"), wire); break;
                        case "dc": if (on != null) on.message(Base64.getDecoder().decode(Json.str(m, "d")), Boolean.TRUE.equals(m.get("t"))); break;
                        case "closed": if (on != null) on.closed(); break;
                        case "fail": case "answerfail": System.err.println("PC process: " + line); replies.offer(m); break;
                        default: replies.offer(m);
                    }
                }
            } catch (IOException | RuntimeException error) { /* the process ended */ }
        }

        final RtcPipe.Wire wire = new RtcPipe.Wire() {
            @Override public boolean send(byte[] data, boolean text) { Pc.this.send(Json.map("k", "dcsend", "t", text, "d", Base64.getEncoder().encodeToString(data))); return true; }
            @Override public long buffered() { return 0; }
            @Override public void close() { Pc.this.send(Json.map("k", "close")); }
        };

        // RtcEngine: the phone's peer connection lives in the PC process (werift)
        @Override public String net() { return "wifi"; }
        @Override public Peer answer(String offer, List<String> stun, Events on) throws IOException {
            events = on;
            send(Json.map("k", "answer", "offer", offer, "stun", new ArrayList<Object>(stun)));
            Map<String, Object> answered;
            try { answered = reply("answered", 15); } catch (Exception error) { throw new IOException("werift did not answer"); }
            String sdp = Json.str(answered, "sdp");
            return new Peer() {
                @Override public String sdp() { return sdp; }
                @Override public void close() { Pc.this.send(Json.map("k", "close")); }
            };
        }
        @Override public void log(String line) { log.add(line); }

        @Override public void close() {
            send(Json.map("k", "quit"));
            try { if (!process.waitFor(5, TimeUnit.SECONDS)) process.destroyForcibly(); } catch (InterruptedException error) { process.destroyForcibly(); }
        }

        /** Channel A's tunnel: frames to and from the PC process. */
        final class StdioPipe implements Pipe {
            volatile Pipe.Listener listener;
            volatile boolean closed;
            @Override public void listen(Pipe.Listener listener) { this.listener = listener; }
            @Override public boolean isClosed() { return closed; }
            @Override public void sendText(String text) { byte[] data = text.getBytes(StandardCharsets.UTF_8); aFrames.add(data); Pc.this.send(Json.map("k", "a", "t", true, "d", Base64.getEncoder().encodeToString(data))); }
            @Override public void sendBinary(byte[] data) { aFrames.add(data); Pc.this.send(Json.map("k", "a", "t", false, "d", Base64.getEncoder().encodeToString(data))); }
            @Override public void close() { if (!closed) { Pc.this.send(Json.map("k", "aclose")); ended(); } }
            void ended() { if (closed) return; closed = true; Pipe.Listener target = listener; if (target != null) target.closed(); }
        }
    }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
        System.out.println("  ok: " + what);
    }
}
