// Owns: the pure parts of the phone's WebRTC way (F25 stage 2) on a host JVM – the candidate filter with the PC's own
// vectors (phone-rtc.test.ts) plus the phone's stricter rule (no mDNS names: libwebrtc would resolve them unchecked);
// the IP literal parser (never a lookup); reading an offer (SDP ≤ 16 KiB, its candidates filtered and at most 32, from
// its ice list only stun: URLs, an empty list stays empty); the messages the phone sends; RtcPipe's framing exactly as
// rtc-socket.ts (16384-byte pieces with MORE, joined up to 8 MiB, every malformed piece ends it, a full send buffer
// ends it); RtcPlan (one try per channel and check, no timer loop, the declines); and what libwebrtc is set to
// (WebRtcConfig with libwebrtc's real Java classes): exactly the offer's ICE servers – none for an empty list –, TCP
// candidates off, one gathering, and a logger at LS_NONE that takes every Java log line of libwebrtc, so none reaches
// the platform log; WebRtc.java injects it and never turns libwebrtc's logcat output on.
// Never: a claim about libwebrtc's native side or a phone's network (the interop run and a device do that).
package com.teydralab.autark.android.relay;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.stream.Stream;
import org.webrtc.Logging;
import org.webrtc.PeerConnection;

public final class RtcSignalTest {
    private static int assertions;

    public static void main(String[] args) throws Exception {
        filter();
        literals();
        offers();
        messages();
        pipe();
        plan();
        config();
        logging();
        sources();
        System.out.println(assertions + " rtc signal assertions passed.");
    }

    private static String line(String address, int port, String type) { return "candidate:1 1 udp 2122260223 " + address + " " + port + " typ " + type; }

    /** The PC's vectors, the same answers; mDNS names are the phone's one stricter step. */
    private static void filter() {
        Object[][] refused = { { "127.0.0.1", 50000 }, { "127.8.9.10", 50000 }, { "0.0.0.0", 50000 }, { "0.1.2.3", 50000 }, { "169.254.169.254", 50000 },
            { "169.254.1.1", 50000 }, { "224.0.0.251", 50000 }, { "239.255.255.250", 50000 }, { "255.255.255.255", 50000 }, { "240.0.0.1", 50000 },
            { "::1", 50000 }, { "::", 50000 }, { "::ffff:127.0.0.1", 50000 }, { "fe80::1", 50000 }, { "ff02::1", 50000 }, { "64:ff9b::7f00:1", 50000 },
            { "10.0.0.5", 80 }, { "192.168.1.2", 1023 }, { "192.168.1.2", 0 }, { "::ffff:169.254.169.254", 50000 }, { "::7f00:1", 50000 }, { "10.0.0.5", 65536 } };
        for (Object[] each : refused) check(RtcSignal.candidateType(line((String) each[0], (Integer) each[1], "host")) == null, "refused: " + each[0] + " " + each[1]);
        Object[][] passed = { { "10.0.0.5", 50000 }, { "172.16.4.4", 1024 }, { "192.168.1.2", 65535 }, { "100.64.1.1", 41641 }, { "100.127.255.1", 50000 },
            { "fd7a:115c:a1e0::1", 50000 }, { "2001:db8::7", 50000 }, { "203.0.113.7", 50000 }, { "::ffff:192.168.1.2", 50000 } };
        for (Object[] each : passed) check("srflx".equals(RtcSignal.candidateType(line((String) each[0], (Integer) each[1], "srflx"))), "passed: " + each[0] + " " + each[1]);
        check(RtcSignal.candidateType(line("5b9c1f2e-1d2a-4f6b-9c1e-0a1b2c3d4e5f.local", 50000, "host")) == null, "the phone takes no mDNS name: libwebrtc would resolve it before any check");
        check(RtcSignal.candidateType("candidate:1 1 tcp 2122260223 10.0.0.5 50000 typ host tcptype passive") == null, "UDP only");
        check(RtcSignal.candidateType(line("evil.example.com", 50000, "host")) == null, "no DNS names");
        check(RtcSignal.candidateType(line("10.0.0.5", 50000, "weird")) == null && RtcSignal.candidateType("candidate:1 1 udp 1 10.0.0.5 50000") == null, "a known type and a whole line");
        check("host".equals(RtcSignal.candidateType("a=" + line("10.0.0.5", 50000, "host"))), "an SDP line with a= reads the same");
        check(RtcSignal.candidateType(line("10.0.0.5", 50000, "host") + " x".repeat(300)) == null, "no line past 512 characters");
    }

    /** Literals only: legacy and padded IPv4 forms, names and broken IPv6 are no address (nothing is ever looked up). */
    private static void literals() {
        check(Arrays.equals(RtcSignal.ip("192.168.1.2"), new byte[] { (byte) 192, (byte) 168, 1, 2 }), "IPv4");
        for (String bad : new String[] { "127.1", "1.2.3", "01.2.3.4", "1.2.3.256", "1.2.3.4.5", "localhost", "", "1::2::3", ":::", "12345::", "g::1", "1:2:3:4:5:6:7:8:9", "::1.2.3", "1.2.3.4::" })
            check(RtcSignal.ip(bad) == null, "no address: '" + bad + "'");
        byte[] v6 = RtcSignal.ip("2001:db8::7");
        check(v6 != null && v6.length == 16 && v6[0] == 0x20 && v6[1] == 0x01 && v6[15] == 7, "IPv6 with ::");
        byte[] mapped = RtcSignal.ip("::ffff:10.1.2.3");
        check(mapped != null && (mapped[10] & 0xff) == 0xff && mapped[12] == 10 && mapped[15] == 3, "IPv6 with an IPv4 tail");
        check(RtcSignal.ip("1:2:3:4:5:6:7:8") != null && RtcSignal.ip("::") != null, "full and empty IPv6");
    }

    private static Map<String, Object> offerMessage(String sdp, Object ice) {
        Map<String, Object> message = Json.map("t", "rtc", "v", 1.0, "op", "offer", "id", "a1b2c3d4e5f60718", "sdp", sdp);
        if (ice != null) message.put("ice", ice);
        return message;
    }

    private static final String SDP_HEAD = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:abcd\r\na=ice-pwd:efghijklmnopqrstuvwxyz\r\na=fingerprint:sha-256 00:11\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n";

    private static void offers() {
        List<Object> ice = Collections.singletonList(Json.map("urls", Arrays.asList("stun:stun.cloudflare.com:3478")));
        String sdp = SDP_HEAD + "a=" + line("192.168.1.20", 50000, "host") + "\r\na=" + line("127.0.0.1", 50000, "host") + "\r\na=" + line("203.0.113.7", 61000, "srflx") + "\r\na=end-of-candidates\r\n";
        RtcSignal.Offer offer = RtcSignal.offer(offerMessage(sdp, ice));
        check(offer != null && offer.id.equals("a1b2c3d4e5f60718"), "an offer is read (" + offer + ")");
        check(offer.stun.equals(Collections.singletonList("stun:stun.cloudflare.com:3478")), "the STUN list is the PC's (" + offer.stun + ")");
        check(offer.sdp.contains("192.168.1.20") && offer.sdp.contains("203.0.113.7") && !offer.sdp.contains("127.0.0.1 50000") && offer.dropped == 1, "the PC's loopback candidate is left out of the SDP libwebrtc gets");
        check(offer.sdp.contains("a=ice-ufrag:abcd\r\n") && offer.sdp.endsWith("\r\n"), "the rest of the SDP stays, CRLF lines");

        check(RtcSignal.offer(offerMessage(sdp, Collections.emptyList())).stun.isEmpty(), "an empty ice list stays empty");
        check(RtcSignal.offer(offerMessage(sdp, null)).stun.isEmpty(), "no ice list: none");
        List<Object> mixed = Arrays.asList(Json.map("urls", Arrays.asList("turn:t.example:3478", "stun:a.example", "stuns:b.example", "http://c.example", "stun:user@d.example", "stun:e.example:3478?transport=udp")),
            Json.map("urls", "stun:[2001:db8::1]:3478"), "stun:not.a.server", Json.map("urls", Arrays.asList("stun:f.example", "stun:g.example", "stun:h.example", "stun:a.example")));
        List<String> stun = RtcSignal.stun(mixed);
        check(stun.equals(Arrays.asList("stun:a.example", "stun:[2001:db8::1]:3478", "stun:f.example", "stun:g.example")), "stun: only, plain host[:port], at most 4, once each (" + stun + ")");

        StringBuilder many = new StringBuilder(SDP_HEAD);
        for (int i = 0; i < 40; i++) many.append("a=").append(line("10.0.0." + (i + 1), 50000, "host")).append("\r\n");
        RtcSignal.Offer capped = RtcSignal.offer(offerMessage(many.toString(), null));
        check(RtcSignal.candidates(capped.sdp).size() == RtcSignal.MAX_CANDIDATES && capped.dropped == 8, "at most 32 of the PC's candidates");

        String exact = SDP_HEAD + "a=x-pad:" + "x".repeat(RtcSignal.MAX_SDP - SDP_HEAD.length() - 10) + "\r\n";
        check(RtcSignal.bytes(exact) == RtcSignal.MAX_SDP && RtcSignal.offer(offerMessage(exact, null)) != null, "16 KiB of SDP is taken");
        String over = exact + "y";
        check(RtcSignal.offer(offerMessage(over, null)) == null, "a byte more is no offer");
        String umlauts = SDP_HEAD + "a=x-pad:" + "ü".repeat((RtcSignal.MAX_SDP - SDP_HEAD.length()) / 2) + "\r\n";
        check(RtcSignal.offer(offerMessage(umlauts, null)) == null, "the limit counts UTF-8 bytes, as the PC does");
        Map<String, Object> other = offerMessage(sdp, null);
        other.put("v", 2.0);
        check(RtcSignal.offer(other) == null, "another version is no offer");
        Map<String, Object> noId = offerMessage(sdp, null);
        noId.remove("id");
        check(RtcSignal.offer(noId) == null, "an offer needs its id");
    }

    private static void messages() {
        check(Json.write(RtcSignal.hello("wifi")).equals("{\"t\":\"rtc\",\"v\":1,\"op\":\"hello\",\"net\":\"wifi\"}"), "hello: " + Json.write(RtcSignal.hello("wifi")));
        check(!RtcSignal.hello("satellite").containsKey("net") && !RtcSignal.hello(null).containsKey("net"), "only the PC's network kinds");
        String answer = Json.write(RtcSignal.answer("id1", "v=0\r\n"));
        check(answer.contains("\"op\":\"answer\"") && answer.contains("\"id\":\"id1\""), "answer");
        Map<String, Object> cand = RtcSignal.candidate("id1", line("10.0.0.5", 50000, "host"));
        @SuppressWarnings("unchecked") Map<String, Object> c = (Map<String, Object>) cand.get("c");
        check("cand".equals(cand.get("op")) && c.get("candidate").equals(line("10.0.0.5", 50000, "host")) && "0".equals(c.get("sdpMid")), "cand as RTCIceCandidateInit");
        check(Boolean.TRUE.equals(RtcSignal.done("id1").get("done")) && "end".equals(RtcSignal.end("id1", "timeout").get("op")), "done and end");
        String stripped = RtcSignal.withoutCandidates(SDP_HEAD + "a=" + line("10.0.0.5", 50000, "host") + "\r\na=end-of-candidates\r\n");
        check(!stripped.contains("candidate") && stripped.equals(SDP_HEAD), "the answer's SDP goes without candidates");
    }

    /** A Wire that keeps what it was given. */
    private static final class Wire implements RtcPipe.Wire {
        final List<byte[]> sent = new ArrayList<>();
        final List<Boolean> texts = new ArrayList<>();
        long buffered;
        boolean closed;
        @Override public boolean send(byte[] data, boolean text) { sent.add(data); texts.add(text); return !closed; }
        @Override public long buffered() { return buffered; }
        @Override public void close() { closed = true; }
    }

    private static final class Heard implements Pipe.Listener {
        final List<byte[]> got = new ArrayList<>();
        final List<Boolean> texts = new ArrayList<>();
        boolean closed;
        @Override public void message(byte[] data, boolean text) { got.add(data); texts.add(text); }
        @Override public void closed() { closed = true; }
    }

    private static void pipe() {
        Wire wire = new Wire();
        RtcPipe pipe = new RtcPipe(wire);
        Heard heard = new Heard();
        pipe.listen(heard);
        check(pipe.direct(), "the data channel counts as direct (status line)");
        pipe.sendText("{\"t\":\"hello\"}");
        check(wire.texts.get(0) && new String(wire.sent.get(0), StandardCharsets.UTF_8).equals("{\"t\":\"hello\"}"), "text goes as one string message");
        byte[] frame = new byte[3 * RtcPipe.PIECE + 100];
        for (int i = 0; i < frame.length; i++) frame[i] = (byte) i;
        pipe.sendBinary(frame);
        check(wire.sent.size() == 5, "three full pieces and a rest");
        for (int i = 1; i <= 3; i++) check(wire.sent.get(i).length == 1 + RtcPipe.PIECE && wire.sent.get(i)[0] == 1 && !wire.texts.get(i), "piece " + i + ": MORE and exactly 16384 bytes");
        check(wire.sent.get(4).length == 101 && wire.sent.get(4)[0] == 0, "the last piece: flags 0, the rest");
        for (int i = 1; i <= 4; i++) pipe.receive(wire.sent.get(i), false);
        check(heard.got.size() == 1 && Arrays.equals(heard.got.get(0), frame), "the pieces join to the frame");
        Wire one = new Wire();
        new RtcPipe(one).sendBinary(new byte[RtcPipe.PIECE]);
        check(one.sent.size() == 1 && one.sent.get(0)[0] == 0 && one.sent.get(0).length == 1 + RtcPipe.PIECE, "exactly 16384 bytes: one last piece");

        byte[][] broken = { {}, { 0 }, { 2, 1 }, { 1, 5 }, piece(1, RtcPipe.PIECE - 1), piece(0, RtcPipe.PIECE + 1) };
        String[] why = { "empty", "flags only", "unknown flag", "MORE on a short piece", "MORE one byte short", "a piece past 16384" };
        for (int i = 0; i < broken.length; i++) {
            Wire w = new Wire();
            RtcPipe p = new RtcPipe(w);
            Heard h = new Heard();
            p.listen(h);
            p.receive(broken[i], false);
            check(p.isClosed() && w.closed && h.closed && h.got.isEmpty(), "ends the pipe: " + why[i]);
        }
        Wire mid = new Wire();
        RtcPipe middle = new RtcPipe(mid);
        Heard midHeard = new Heard();
        middle.listen(midHeard);
        middle.receive(piece(1, RtcPipe.PIECE), false);
        middle.receive("{}".getBytes(StandardCharsets.UTF_8), true);
        check(middle.isClosed() && midHeard.got.isEmpty(), "text in the middle of a frame ends it");
        Wire big = new Wire();
        RtcPipe huge = new RtcPipe(big);
        for (int i = 0; i < 513 && !huge.isClosed(); i++) huge.receive(piece(1, RtcPipe.PIECE), false);
        check(huge.isClosed(), "a frame past 8 MiB ends it");
        Wire full = new Wire();
        full.buffered = RtcPipe.MAX_BUFFERED + 1;
        RtcPipe slow = new RtcPipe(full);
        slow.sendBinary(new byte[10]);
        check(slow.isClosed() && full.sent.isEmpty(), "a send buffer past 16 MiB ends it (the tunnel takes over)");
        Wire refusing = new Wire();
        refusing.closed = true;
        RtcPipe gone = new RtcPipe(refusing);
        gone.sendText("x");
        check(gone.isClosed(), "a data channel that refuses a message ends the pipe");
    }

    private static byte[] piece(int flags, int length) {
        byte[] out = new byte[1 + length];
        out[0] = (byte) flags;
        return out;
    }

    private static void plan() {
        RtcPlan plan = new RtcPlan();
        Object a = new Object(), a2 = new Object();
        check(plan.due(a, 0) && !plan.due(null, 0), "a new channel: a try is due");
        plan.started(a);
        check(!plan.due(a, 0), "one try per channel");
        plan.ended(a, "timeout", false, 1_000);
        check(!plan.due(a, 10_000_000) && plan.nextAgain(1_000) == Long.MAX_VALUE, "a failed try waits for the next channel or check – no timer");
        plan.check();
        check(plan.due(a, 2_000), "after check() (resume, network change) one more");
        plan.started(a);
        check(!plan.due(a, 2_000), "and only one");
        check(plan.due(a2, 2_000), "a new channel (reconnect) gets its try");
        plan.started(a2);
        plan.ended(a2, "lost", true, 10_000);
        check(!plan.due(a2, 39_999) && plan.due(a2, 40_000) && plan.nextAgain(10_000) == 30_000, "a way that carried and ended: again after 30 s");
        plan.started(a2);
        plan.ended(a2, "lost", true, 50_000);
        check(!plan.due(a2, 169_999) && plan.due(a2, 170_000), "then after 2 min");
        plan.started(a2);
        plan.ended(a2, "lost", true, 200_000);
        check(plan.due(a2, 800_000) && !plan.due(a2, 799_999), "then after 10 min");
        plan.started(a2);
        plan.ended(a2, "lost", true, 900_000);
        check(!plan.due(a2, 1_499_999) && plan.due(a2, 1_500_000), "and stays at 10 min");
        plan.check();
        check(plan.due(a2, 900_001), "check() starts the pause over: due now");
        for (String no : new String[] { "off", "version", "old", "nooffer" }) {
            RtcPlan p = new RtcPlan();
            Object ch = new Object();
            p.started(ch);
            p.ended(ch, no, false, 0);
            p.check();
            check(!p.due(ch, 0) && p.due(new Object(), 0), no + ": no more tries on that channel, a new one may");
        }
        for (String later : new String[] { "busy", "full", "later", "failed", "timeout", "no" }) {
            RtcPlan p = new RtcPlan();
            Object ch = new Object();
            p.started(ch);
            p.ended(ch, later, false, 0);
            check(!p.due(ch, 3_600_000), later + ": no timer");
            p.check();
            check(p.due(ch, 0), later + ": the next check tries");
        }
        RtcPlan refused = new RtcPlan();
        refused.started(a);
        refused.ended(a, "refused", false, 0);
        refused.check();
        check(!refused.due(a, 0) && !refused.due(new Object(), 0) && refused.nextAgain(0) == Long.MAX_VALUE, "refused: no try for the rest of the connection");
    }

    /** libwebrtc's own RTCConfiguration, as its native side reads it (getIceServers()). */
    private static void config() throws Exception {
        PeerConnection.RTCConfiguration none = WebRtcConfig.of(Collections.emptyList());
        check(none.iceServers.isEmpty() && servers(none).isEmpty(), "an empty STUN list: no ICE server at all");
        PeerConnection.RTCConfiguration one = WebRtcConfig.of(Arrays.asList("stun:stun.cloudflare.com:3478", "stun:192.0.2.1:3478"));
        List<?> served = servers(one);
        check(served.size() == 1 && ((PeerConnection.IceServer) served.get(0)).urls.equals(Arrays.asList("stun:stun.cloudflare.com:3478", "stun:192.0.2.1:3478")), "exactly the offer's STUN URLs (" + served + ")");
        PeerConnection.IceServer server = (PeerConnection.IceServer) served.get(0);
        check(server.username.isEmpty() && server.password.isEmpty(), "no credentials");
        check(!String.valueOf(servers(one)).contains("google") && !String.valueOf(servers(none)).contains("stun"), "nothing of libwebrtc's own");
        PeerConnection.RTCConfiguration defaults = new PeerConnection.RTCConfiguration(new ArrayList<>());
        check(defaults.tcpCandidatePolicy == PeerConnection.TcpCandidatePolicy.ENABLED, "libwebrtc's default would gather TCP candidates (the setting below matters)");
        check(none.tcpCandidatePolicy == PeerConnection.TcpCandidatePolicy.DISABLED, "own candidates UDP only");
        check(none.continualGatheringPolicy == PeerConnection.ContinualGatheringPolicy.GATHER_ONCE && none.iceCandidatePoolSize == 0, "gathered once, no pool (battery)");
        check(none.iceTransportsType == PeerConnection.IceTransportsType.ALL && none.sdpSemantics == PeerConnection.SdpSemantics.UNIFIED_PLAN, "all candidate types, unified plan");
        check(none.bundlePolicy == PeerConnection.BundlePolicy.MAXBUNDLE && none.rtcpMuxPolicy == PeerConnection.RtcpMuxPolicy.REQUIRE && none.keyType == PeerConnection.KeyType.ECDSA, "one transport, ECDSA (matches the PC's werift)");
        check("srflx".equals(WebRtcConfig.type("candidate:1 1 udp 1 203.0.113.7 61000 typ srflx raddr 0.0.0.0 rport 0")) && "other".equals(WebRtcConfig.type("candidate:1 1 udp 1 10.0.0.1 1 typ 10.0.0.1")) && "other".equals(WebRtcConfig.type(null)), "a log names only a candidate type");
    }

    private static List<?> servers(PeerConnection.RTCConfiguration config) throws Exception {
        Method read = PeerConnection.RTCConfiguration.class.getDeclaredMethod("getIceServers"); // what libwebrtc's JNI reads
        read.setAccessible(true);
        return (List<?>) read.invoke(config);
    }

    /** With WebRtcConfig's logger injected (as PeerConnectionFactory.initialize does), no libwebrtc Java line reaches the platform log. */
    private static void logging() throws Exception {
        check(WebRtcConfig.LOG_LEVEL == Logging.Severity.LS_NONE, "the logger's level is LS_NONE");
        List<String> platform = new ArrayList<>();
        Logger fallback = Logger.getLogger("org.webrtc.Logging");
        Handler keep = new Handler() {
            @Override public void publish(LogRecord record) { platform.add(record.getMessage()); }
            @Override public void flush() { }
            @Override public void close() { }
        };
        fallback.addHandler(keep);
        try {
            Logging.e("Probe", "before: candidate 192.168.1.2");
            check(platform.size() == 1, "without the logger libwebrtc's Java lines reach the platform log (Android: logcat) – the probe sees them");
            platform.clear();
            Method inject = Logging.class.getDeclaredMethod("injectLoggable", org.webrtc.Loggable.class, Logging.Severity.class);
            inject.setAccessible(true);
            inject.invoke(null, WebRtcConfig.SILENT, WebRtcConfig.LOG_LEVEL);
            for (Logging.Severity severity : new Logging.Severity[] { Logging.Severity.LS_VERBOSE, Logging.Severity.LS_INFO, Logging.Severity.LS_WARNING, Logging.Severity.LS_ERROR })
                Logging.log(severity, "NetworkMonitor", "candidate:1 1 udp 1 192.168.1.2 50000 typ host");
            Logging.e("PeerConnection", "error 10.0.0.5", new RuntimeException("x"));
            check(platform.isEmpty(), "with it, not one line (" + platform + ")");
        } finally {
            fallback.removeHandler(keep);
        }
    }

    /** WebRtc.java injects that logger and never turns libwebrtc's logcat output on; no source names a STUN server. */
    private static void sources() throws Exception {
        Path relay = Paths.get(System.getProperty("autark.android", "."), "app/src/main/java/com/teydralab/autark/android/relay");
        String webrtc = new String(Files.readAllBytes(relay.resolve("WebRtc.java")), StandardCharsets.UTF_8);
        check(webrtc.contains(".setInjectableLogger(WebRtcConfig.SILENT, WebRtcConfig.LOG_LEVEL)"), "the factory starts with the silent logger");
        check(!webrtc.contains("enableLogToDebugOutput(") && !webrtc.contains("enableLogThreads(") && !webrtc.contains("Log.d("), "libwebrtc's logcat output stays off");
        check(webrtc.contains("createPeerConnection(WebRtcConfig.of(stun)"), "every peer connection takes WebRtcConfig.of(the offer's list)");
        try (Stream<Path> files = Files.walk(Paths.get(System.getProperty("autark.android", "."), "app/src/main"))) {
            for (Path file : (Iterable<Path>) files.filter((p) -> p.toString().endsWith(".java"))::iterator) {
                String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
                check(!text.contains("l.google.com") && !text.matches("(?s).*\"stuns?:[a-z0-9].*"), "no STUN server named in " + file.getFileName());
            }
        }
    }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
    }
}
