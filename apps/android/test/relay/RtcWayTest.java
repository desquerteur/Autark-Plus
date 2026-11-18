// Owns: the phone's WebRTC way (F25 stage 2: RtcWay and PageRtc) on a host JVM against a stand-in PC that runs the real
// pinned handshake on both channels – A over an in-memory pipe, B over two RtcPipes joined back to back – and a
// stand-in libwebrtc (RtcEngine) the test drives: the whole try in order (hello on the finished A only and sealed –
// no SDP, candidate or address in A's bytes; the offer's STUN list exactly as libwebrtc's ICE servers, an empty one
// empty; the PC's loopback candidate kept from libwebrtc; the answer without candidates, ours as cand through the
// filter, at most 32, then done; the handshake again on B with the PC's key; ready makes B the page's channel), every
// way back to the tunnel (no, no answer, end before an offer, a bad or oversized offer, timeout, the PC's end, ICE
// failed or disconnected past 5 s, another key on B, the data channel closing, the page moving), and log lines without
// one address. PageRtc: one try per channel, none on a direct channel, B only while it carries, and B's end gives the
// page A back.
// Never: libwebrtc itself or a phone's network (the interop run against the PC's code and a device do that).
package com.teydralab.autark.android.relay;

import static com.teydralab.autark.android.relay.RtcStandIns.*;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

public final class RtcWayTest {
    private static int assertions;
    private static final Pattern ADDRESS = Pattern.compile("\\b\\d{1,3}(\\.\\d{1,3}){3}\\b|[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{0,4}){2,7}");

    public static void main(String[] args) throws Exception {
        whole();
        noes();
        silentAndUnoffered();
        badOffers();
        timeout();
        pcEnds();
        ice();
        otherKeyOnB();
        wayEnds();
        engineMissing();
        candidateCap();
        page();
        for (String line : LOG) check(!ADDRESS.matcher(line).find(), "a log line without an address: " + line);
        check(LOG.size() >= 15, "every try wrote its line (" + LOG.size() + ")");
        System.out.println(assertions + " rtc way assertions passed.");
        System.exit(0); // the stand-ins' daemon threads
    }

    // ------------------------------------------------------------------ the scenarios

    private static void whole() throws Exception {
        Rig rig = new Rig();
        Map<String, Object> hello = rig.pcA.next("hello");
        check("wifi".equals(hello.get("net")) && Json.num(hello, "v", 0) == 1, "hello with the network kind");
        check(rig.wireA.plainFree(), "A's bytes are sealed frames only: no rtc, sdp or candidate in the clear");
        rig.offer(Collections.singletonList(Json.map("urls", Arrays.asList("stun:stun.cloudflare.com:3478"))));
        Answer answer = rig.engine.next();
        check(answer.stun.equals(Collections.singletonList("stun:stun.cloudflare.com:3478")), "libwebrtc gets exactly the offer's STUN list (" + answer.stun + ")");
        check(answer.offer.contains("192.168.1.20 50000") && !answer.offer.contains("127.0.0.1 50000"), "the PC's loopback candidate never reaches libwebrtc");
        Map<String, Object> sent = rig.pcA.next("answer");
        String sdp = Json.str(sent, "sdp");
        check(sdp != null && !sdp.contains("candidate") && sdp.startsWith("v=0"), "the answer goes without candidate lines");
        List<String> lines = rig.candidates(1);
        check(lines.get(0).contains("192.168.1.30"), "the answer's own candidate follows as cand (" + lines + ")");
        answer.events.candidate("candidate:2 1 tcp 1 192.168.1.30 9 typ host tcptype active");
        answer.events.candidate("candidate:3 1 udp 1 127.0.0.1 50001 typ host");
        answer.events.candidate("candidate:4 1 udp 1 203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0");
        answer.events.candidate("candidate:4 1 udp 1 203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0");
        answer.events.gathered();
        List<String> more = rig.candidates(1);
        check(more.get(0).contains("srflx"), "a trickled srflx goes once; TCP and loopback stay home (" + more + ")");
        check(rig.pcA.next("cand").get("done") == Boolean.TRUE, "done after the last");
        answer.events.ice("checking");
        answer.events.ice("connected");
        answer.events.pair("host", "srflx");
        PeerChannel b = rig.openB(answer, PC_SEED);
        check(b != null && rig.way.carrying() == b, "after the handshake on B and the PC's ready, B carries the page");
        check(rig.owner.readies.poll(2, TimeUnit.SECONDS) == rig.way, "the connection heard ready");
        rig.pcB.send(Json.map("t", "d", "s", 1, "b", "aGk="));
        Map<String, Object> stream = rig.owner.messages.poll(2, TimeUnit.SECONDS);
        check(stream != null && "d".equals(stream.get("t")), "B's stream messages reach the entrance");
        b.send(Json.map("t", "o", "s", 2));
        check("o".equals(rig.pcB.next(null).get("t")), "and the phone's reach the PC over B");
        check(rig.wireA.plainFree(), "still nothing in the clear on A");
        rig.way.close("moved");
        check("end".equals(rig.pcA.next("end").get("op")) && answer.peer.closed && b.isClosed(), "the connection ends it: end on A, peer and B closed");
        Over over = rig.owner.over();
        check(over.outcome.equals("moved") && over.wasReady, "over: moved, after it carried");
        check(LOG.stream().anyMatch((line) -> line.startsWith("rtc ok") && line.contains("local=host remote=srflx") && line.contains("net=wifi")), "the ok line names types and the network (" + LOG + ")");
    }

    private static void noes() throws Exception {
        for (String why : new String[] { "off", "busy", "full", "refused", "version", "later", "whatever" }) {
            Rig rig = new Rig();
            rig.pcA.next("hello");
            rig.pcA.send(Json.map("t", "rtc", "v", 1, "op", "no", "why", why));
            Over over = rig.owner.over();
            check(over.outcome.equals(why.equals("whatever") ? "no" : why) && !over.wasReady && rig.engine.calls == 0, "no " + why + ": over, libwebrtc never asked");
        }
    }

    private static void silentAndUnoffered() throws Exception {
        Rig old = new Rig();
        old.pcA.next("hello");
        long start = System.currentTimeMillis();
        Over over = old.owner.over();
        check(over.outcome.equals("old") && System.currentTimeMillis() - start >= 900, "no answer to hello: an older PC (" + over.outcome + ")");
        Rig unguarded = new Rig();
        unguarded.pcA.next("hello");
        unguarded.pcA.send(Json.map("t", "rtc", "v", 1, "op", "end", "id", "x1", "why", "failed"));
        check(unguarded.owner.over().outcome.equals("nooffer") && unguarded.engine.calls == 0, "end after hello: the PC can't offer (fail-closed) – no");
        check(unguarded.pcA.quiet(null), "nothing back to it");
    }

    private static void badOffers() throws Exception {
        Rig big = new Rig();
        big.pcA.next("hello");
        big.pcA.send(Json.map("t", "rtc", "v", 1, "op", "offer", "id", "f00d", "sdp", OFFER_SDP + "a=x-pad:" + "x".repeat(RtcSignal.MAX_SDP) + "\r\n", "ice", Collections.emptyList()));
        Map<String, Object> end = big.pcA.next("end");
        check("f00d".equals(end.get("id")) && "failed".equals(end.get("why")) && big.engine.calls == 0, "an offer past 16 KiB: end failed, libwebrtc never asked");
        check(big.owner.over().outcome.equals("failed"), "over: failed");
        Rig fat = new Rig();
        fat.engine.answerSdp = ANSWER_SDP + "a=x-pad:" + "y".repeat(RtcSignal.MAX_SDP) + "\r\n";
        fat.pcA.next("hello");
        fat.offer(Collections.emptyList());
        Answer answer = fat.engine.next();
        check(answer.stun.isEmpty(), "an empty ice list: libwebrtc gets no server");
        check("failed".equals(fat.pcA.next("end").get("why")) && answer.peer.closed, "our own answer past 16 KiB never goes out: end failed, peer closed");
    }

    private static void timeout() throws Exception {
        Rig rig = new Rig();
        rig.pcA.next("hello");
        rig.offer(Collections.emptyList());
        Answer answer = rig.engine.next();
        rig.pcA.next("answer");
        Map<String, Object> end = rig.pcA.next("end");
        check("timeout".equals(end.get("why")) && rig.owner.over().outcome.equals("timeout") && answer.peer.closed, "no ready within the try's time: end timeout, peer closed");
    }

    private static void pcEnds() throws Exception {
        for (String why : new String[] { "refused", "timeout", "failed", "odd" }) {
            Rig rig = new Rig();
            rig.pcA.next("hello");
            String id = rig.offer(Collections.emptyList());
            Answer answer = rig.engine.next();
            rig.pcA.next("answer");
            rig.pcA.send(Json.map("t", "rtc", "v", 1, "op", "end", "id", "someone-else", "why", "failed"));
            rig.pcA.send(Json.map("t", "rtc", "v", 1, "op", "end", "id", id, "why", why));
            Over over = rig.owner.over();
            check(over.outcome.equals(why.equals("odd") ? "failed" : why) && answer.peer.closed, "the PC's end " + why + " (another id ignored)");
            check(rig.pcA.quiet("end"), "no end back to the PC that ended it");
        }
    }

    private static void ice() throws Exception {
        Rig failed = new Rig();
        failed.pcA.next("hello");
        failed.offer(Collections.emptyList());
        Answer a1 = failed.engine.next();
        failed.pcA.next("answer");
        a1.events.ice("failed");
        check("failed".equals(failed.pcA.next("end").get("why")) && a1.peer.closed, "ICE failed: end failed");
        Rig away = new Rig();
        away.pcA.next("hello");
        away.offer(Collections.emptyList());
        Answer a2 = away.engine.next();
        away.pcA.next("answer");
        a2.events.ice("disconnected");
        Thread.sleep(60);
        a2.events.ice("connected");
        Thread.sleep(500);
        check(!away.way.over(), "disconnected and back within the grace: the try goes on");
        a2.events.ice("disconnected");
        check("failed".equals(away.pcA.next("end").get("why")), "disconnected past the grace: it ends");
    }

    private static void otherKeyOnB() throws Exception {
        Rig rig = new Rig();
        rig.pcA.next("hello");
        rig.offer(Collections.emptyList());
        Answer answer = rig.engine.next();
        rig.pcA.next("answer");
        answer.events.open("other", new Back(null));
        check(!rig.way.over(), "a data channel with another label is closed and the try goes on");
        PeerChannel b = rig.openB(answer, Crypto.newSeed());
        check(b == null && rig.way.carrying() == null, "B whose end proves another key than A's PC: no channel (DTLS is no identity)");
        check("failed".equals(rig.pcA.next("end").get("why")) && rig.owner.over().outcome.equals("failed"), "end failed");
    }

    private static void wayEnds() throws Exception {
        for (String how : new String[] { "channel", "pc-end", "ice" }) {
            Rig rig = new Rig();
            rig.pcA.next("hello");
            String id = rig.offer(Collections.emptyList());
            Answer answer = rig.engine.next();
            rig.pcA.next("answer");
            PeerChannel b = rig.openB(answer, PC_SEED);
            check(b != null, "B carries (" + how + ")");
            if (how.equals("channel")) answer.events.closed();
            else if (how.equals("pc-end")) rig.pcA.send(Json.map("t", "rtc", "v", 1, "op", "end", "id", id, "why", "lost"));
            else answer.events.ice("failed");
            Over over = rig.owner.over();
            check(over.outcome.equals("lost") && over.wasReady && b.isClosed() && rig.way.carrying() == null, "a way that carried ends (" + how + "): lost, B closed, the page goes back to A");
        }
    }

    private static void engineMissing() throws Exception {
        Rig rig = new Rig();
        rig.engine.missing = true;
        rig.pcA.next("hello");
        String id = rig.offer(Collections.emptyList());
        Map<String, Object> end = rig.pcA.next("end");
        check(id.equals(end.get("id")) && "failed".equals(end.get("why")) && rig.owner.over().outcome.equals("failed"), "no libwebrtc on this phone: end failed, the tunnel stays");
    }

    private static void candidateCap() throws Exception {
        Rig rig = new Rig();
        rig.pcA.next("hello");
        rig.offer(Collections.emptyList());
        Answer answer = rig.engine.next();
        rig.pcA.next("answer");
        rig.candidates(1);
        for (int i = 0; i < 40; i++) answer.events.candidate("candidate:9 1 udp 1 10.1.0." + (i + 1) + " 50000 typ host");
        answer.events.gathered();
        List<String> all = rig.candidates(31);
        check(all.size() == 31 && rig.pcA.next("cand").get("done") == Boolean.TRUE, "at most 32 candidates of ours in all, then done");
        rig.way.close("closed");
    }

    /** PageRtc: when a try starts, which channel the page gets, and the way back. */
    private static void page() throws Exception {
        Rig rig = new Rig(false);
        List<PeerChannel> ended = new CopyOnWriteArrayList<>();
        int[] nudges = new int[1];
        PageRtc page = new PageRtc(rig.engine, PHONE_SEED, "dev_phone", new PageRtc.Host() {
            @Override public void deliver(PeerChannel b, Map<String, Object> message) { }
            @Override public void channelClosed(PeerChannel b) { ended.add(b); }
            @Override public void nudge() { nudges[0]++; }
        });
        Rig.Wired direct = Rig.wire(true);
        page.step(direct.channel, PC_PUB);
        check(direct.pc.quiet("hello"), "no try on a direct channel (F29's socket to the PC)");
        page.step(rig.a, PC_PUB);
        check(rig.pcA.next("hello") != null, "a try on the page's tunnel channel");
        page.step(rig.a, PC_PUB);
        check(rig.pcA.quiet("hello"), "one try at a time");
        check(page.via(rig.a) == rig.a, "the page stays on A until B is ready");
        Map<String, Object> offer = Json.map("t", "rtc", "v", 1.0, "op", "offer", "id", "p1", "sdp", OFFER_SDP, "ice", Collections.emptyList()); // as parsed from A
        page.signal(rig.a, offer);
        Answer answer = rig.engine.next();
        rig.pcA.next("answer");
        PeerChannel b = rig.openB(answer, PC_SEED, "p1", () -> page.via(rig.a) == rig.a ? null : page.via(rig.a));
        Thread.sleep(100);
        check(b != null && page.via(rig.a) == b && page.via(direct.channel) == direct.channel, "after ready the page's PC is reached over B, other channels unchanged");
        page.closed(rig.a);
        Thread.sleep(150);
        check(b.isClosed() && page.via(rig.a) == rig.a && ended.contains(b) && nudges[0] >= 2, "A closing ends B: its streams end and the page is on A again");
        page.step(rig.a, PC_PUB);
        check(rig.pcA.quiet("hello"), "a way that ended with its channel: no new try on that channel by itself");
        page.check();
        page.step(rig.a, PC_PUB);
        check(rig.pcA.next("hello") != null, "after check() (resume, network change): one more try");
        page.signal(rig.a, Json.map("t", "rtc", "v", 1.0, "op", "offer", "id", "p2", "sdp", OFFER_SDP, "ice", Collections.emptyList()));
        Answer second = rig.engine.next();
        rig.pcA.next("answer");
        page.stop();
        check("p2".equals(rig.pcA.next("end").get("id")) && second.peer.closed, "stop() ends it: the PC hears end, the peer closes");
    }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
    }
}
