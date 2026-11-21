// Owns: the phone's direct way to a PC (F29 stage 1) on a host JVM – a PC's addresses become ws(s)://…/peer/phone and
// survive storage; Route takes the first direct pipe that opens and closes the late ones; it falls back to the tunnel when
// no address answers in time, when the handshake over the direct pipe fails, or when the PC lists none; the real pinned
// handshake and encrypted frames run over DirectPipe against a loopback stand-in of the PC's /peer/phone (the tunnel is
// never opened then); a closed port fails at once and a silent one within DirectPipe.CONNECT_MS.
// Never: a test against a real PC or a claim about Android's own networks (Wi-Fi, mobile data, a router – a phone does that).
package com.teydralab.autark.android.relay;

import java.io.DataInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class DirectRouteTest {
    private static int assertions;

    public static void main(String[] args) throws Exception {
        urls();
        storedAddresses();
        firstOpens();
        noneOpens();
        fallsBack();
        handshakeOverDirectPipe();
        refusedAndSilent();
        System.out.println(assertions + " direct route assertions passed.");
    }

    private static void urls() {
        check("ws://192.168.1.20:47812/peer/phone".equals(DirectPipe.url("http://192.168.1.20:47812")), "a LAN address becomes ws://…/peer/phone");
        check("wss://desk.tail1234.ts.net/peer/phone".equals(DirectPipe.url("https://desk.tail1234.ts.net/")), "https becomes wss, the path is the phone's");
        check("ws://[2001:db8::7]:47812/peer/phone".equals(DirectPipe.url("http://[2001:db8::7]:47812")), "an IPv6 address keeps its brackets");
        check(DirectPipe.url("relay:abc") == null && DirectPipe.url("ftp://h:1") == null && DirectPipe.url("http://u:p@h:1") == null && DirectPipe.url(null) == null, "anything but plain http(s) is no direct address");
    }

    /** phoneUse.attach's addresses are kept with the PC (storage JSON) and never more than 8 usable ones. */
    private static void storedAddresses() {
        byte[] pub = Crypto.ed25519Public(Crypto.newSeed());
        List<Object> given = new ArrayList<>(Arrays.asList("http://203.0.113.7:47812", "http://192.168.1.20:47812", "relay:abc", "http://192.168.1.20:47812"));
        for (int i = 0; i < 10; i++) given.add("http://10.0.0." + i + ":47812");
        List<PhoneConnection.Pc> pcs = PhoneConnection.Paired.pcsOf(Collections.singletonList(Json.map("fingerprint", Crypto.fingerprint(pub), "publicKey", Crypto.b64url(pub), "name", "Desk", "deviceId", "dev_desk", "addresses", given)));
        check(pcs.size() == 1 && pcs.get(0).addresses.size() == 8, "at most 8 addresses, invalid and repeated ones skipped (" + pcs.get(0).addresses + ")");
        check(pcs.get(0).addresses.get(0).equals("http://203.0.113.7:47812") && !pcs.get(0).addresses.contains("relay:abc"), "the PC's order stays");
        PhoneConnection.Paired paired = new PhoneConnection.Paired("wss://relay.test", Crypto.b64url(Crypto.newSeed()), "dev_phone", "token", pcs);
        List<PhoneConnection.Pc> back = PhoneConnection.Paired.pcsOf(Json.parse(paired.pcsJson()));
        check(back.get(0).addresses.equals(pcs.get(0).addresses), "the addresses survive storage");
        PhoneConnection.Pc old = PhoneConnection.Paired.pcsOf(Collections.singletonList(Json.map("fingerprint", Crypto.fingerprint(pub), "publicKey", Crypto.b64url(pub), "name", "Desk"))).get(0);
        check(old.addresses.isEmpty() && !Json.parse(new PhoneConnection.Paired("r", "s", "d", "t", Collections.singletonList(old)).pcsJson()).toString().contains("addresses"), "a PC without addresses stays as it was stored");
    }

    /** The first pipe that opens wins; a slower one is closed when it opens; a failing one does not matter. */
    private static void firstOpens() throws Exception {
        FakePipe slow = new FakePipe("slow", true), fast = new FakePipe("fast", true);
        long start = System.currentTimeMillis();
        Pipe won = Route.first(Arrays.asList(after(300, slow), after(20, fast), failing(5)), 1_500);
        check(won == fast && System.currentTimeMillis() - start < 280, "the first pipe that opens wins at once");
        Thread.sleep(450);
        check(slow.closed && !fast.closed, "the later pipe closed as it opened");
        long all = System.currentTimeMillis();
        check(Route.first(Arrays.asList(failing(5), failing(10)), 1_500) == null && System.currentTimeMillis() - all < 600, "every address failing ends the wait at once");
    }

    /** Nothing within the window: null after the window; a pipe opening later is closed. */
    private static void noneOpens() throws Exception {
        FakePipe late = new FakePipe("late", true);
        long start = System.currentTimeMillis();
        Pipe won = Route.first(Collections.singletonList(after(700, late)), 200);
        long took = System.currentTimeMillis() - start;
        check(won == null && took >= 190 && took < 600, "no pipe within the window (" + took + " ms)");
        Thread.sleep(800);
        check(late.closed, "a pipe opening after the window is closed");
    }

    /** Direct when it answers; the tunnel when no address answers, when the direct handshake fails, or without addresses. */
    private static void fallsBack() throws Exception {
        AtomicInteger tunnels = new AtomicInteger();
        Route.Opener tunnel = () -> { tunnels.incrementAndGet(); return new FakePipe("tunnel", false); };
        Route.Handshake<String> named = (pipe) -> ((FakePipe) pipe).name;
        check("direct".equals(Route.open(Collections.singletonList(after(10, new FakePipe("direct", true))), 500, tunnel, named)) && tunnels.get() == 0, "a direct address that answers is used, the tunnel never opened");
        check("tunnel".equals(Route.open(Collections.singletonList(failing(5)), 500, tunnel, named)) && tunnels.get() == 1, "no direct answer: the tunnel");
        FakePipe stranger = new FakePipe("stranger", true);
        Route.Handshake<String> refusing = (pipe) -> { if (pipe.direct()) throw new IOException("This is not the paired PC."); return ((FakePipe) pipe).name; };
        check("tunnel".equals(Route.open(Collections.singletonList(after(5, stranger)), 500, tunnel, refusing)) && stranger.closed && tunnels.get() == 2, "a failed handshake on the direct pipe closes it and takes the tunnel");
        check("tunnel".equals(Route.open(Collections.emptyList(), 500, tunnel, named)) && tunnels.get() == 3, "a PC without addresses: the tunnel at once");
        boolean threw = false;
        try { Route.open(Collections.singletonList(failing(5)), 300, null, named); } catch (IOException expected) { threw = true; }
        check(threw && tunnels.get() == 3, "direct only (the upgrade after a resume) throws and opens no tunnel");
    }

    /** The real handshake and encrypted frames over DirectPipe to a stand-in of the PC's /peer/phone; the tunnel stays shut. */
    private static void handshakeOverDirectPipe() throws Exception {
        byte[] pcSeed = Crypto.newSeed();
        byte[] pcPub = Crypto.ed25519Public(pcSeed);
        byte[] phoneSeed = Crypto.newSeed();
        try (FakeWs server = new FakeWs(FakeWs.Mode.UPGRADE_ONLY)) {
            BlockingQueue<String> seen = new ArrayBlockingQueue<>(4);
            Thread pc = new Thread(() -> { try { seen.offer(pcSide(server, pcSeed, pcPub, Crypto.ed25519Public(phoneSeed))); } catch (Exception error) { seen.offer("pc failed: " + error); } }, "fake-pc");
            pc.setDaemon(true);
            pc.start();
            AtomicInteger tunnels = new AtomicInteger();
            BlockingQueue<Map<String, Object>> messages = new ArrayBlockingQueue<>(4);
            CountDownLatch closed = new CountDownLatch(1);
            PeerChannel.Listener listener = new PeerChannel.Listener() {
                @Override public void message(Map<String, Object> message) { messages.offer(message); }
                @Override public void closed() { closed.countDown(); }
            };
            List<String> addresses = Arrays.asList("http://127.0.0.1:" + closedPort(), "http://127.0.0.1:" + server.server.getLocalPort());
            PeerChannel channel = Route.open(DirectPipe.openers(addresses), Route.DIRECT_MS,
                    () -> { tunnels.incrementAndGet(); throw new IOException("no tunnel in this test"); },
                    (pipe) -> PeerChannel.connect(pipe, phoneSeed, "dev_phone", pcPub, listener));
            check(channel.direct() && tunnels.get() == 0, "the handshake ran over the direct pipe, no tunnel opened");
            channel.send(Json.map("t", "o", "s", 1));
            Map<String, Object> reply = messages.poll(5, TimeUnit.SECONDS);
            check(reply != null && "e".equals(reply.get("t")) && Json.num(reply, "s", -1) == 1, "an encrypted frame went to the PC and its answer came back (" + reply + ")");
            check("ok".equals(seen.poll(5, TimeUnit.SECONDS)), "the PC saw the phone's key and its signed auth");
            check(closed.await(5, TimeUnit.SECONDS) && channel.isClosed(), "the PC closing the socket closes the channel");
        }
    }

    /** The PC's side: hello → welcome (signed), auth checked, one frame opened and answered, then the socket closes. */
    private static String pcSide(FakeWs server, byte[] pcSeed, byte[] pcPub, byte[] phonePub) throws Exception {
        Socket socket = null;
        for (int i = 0; i < 200 && socket == null; i++) { socket = server.last; if (socket == null) Thread.sleep(10); }
        if (socket == null) return "no socket";
        Thread.sleep(50); // the upgrade answer is written right after accept
        DataInputStream in = new DataInputStream(socket.getInputStream());
        int[] op = new int[1];
        Map<String, Object> hello = Json.object(new String(FakeWs.read(in, op), StandardCharsets.UTF_8));
        if (op[0] != 0x1 || !"hello".equals(hello.get("t"))) return "no hello";
        byte[] pub = Crypto.fromB64url(Json.str(hello, "pub"));
        if (!Arrays.equals(pub, phonePub)) return "another key";
        byte[] eph = Crypto.fromB64url(Json.str(hello, "eph"));
        byte[] nonce = Crypto.fromB64url(Json.str(hello, "n"));
        byte[][] mine = Crypto.x25519Pair();
        byte[] hash = Crypto.sha256(Crypto.concat(Crypto.utf8("wf-peer-v1"), pub, eph, nonce, pcPub, mine[1]));
        String welcome = Json.write(Json.map("t", "welcome", "v", 1, "id", "dev_pc", "pub", Crypto.b64url(pcPub), "eph", Crypto.b64url(mine[1]), "sig", Crypto.b64url(Crypto.sign(pcSeed, Crypto.concat(Crypto.utf8("server"), hash)))));
        FakeWs.send(socket, 0x1, welcome.getBytes(StandardCharsets.UTF_8));
        Map<String, Object> auth = Json.object(new String(FakeWs.read(in, op), StandardCharsets.UTF_8));
        if (!Crypto.verify(pub, Crypto.concat(Crypto.utf8("client"), hash), Crypto.fromB64url(Json.str(auth, "sig")))) return "bad auth";
        byte[] okm = Crypto.hkdf(Crypto.x25519(mine[0], eph), hash, "wf-peer-v1 keys", 64);
        byte[] receive = Arrays.copyOfRange(okm, 0, 32), send = Arrays.copyOfRange(okm, 32, 64);
        byte[] frame = FakeWs.read(in, op);
        long counter = 0;
        for (int i = 0; i < 8; i++) counter = (counter << 8) | (frame[i] & 0xff);
        byte[] plain = Crypto.open(receive, counter, frame, 8, frame.length - 8);
        if (op[0] != 0x2 || plain == null || !new String(plain, StandardCharsets.UTF_8).contains("\"o\"")) return "bad frame";
        byte[] body = Crypto.seal(send, 0, Crypto.utf8(Json.write(Json.map("t", "e", "s", 1))));
        byte[] out = new byte[8 + body.length];
        System.arraycopy(body, 0, out, 8, body.length);
        FakeWs.send(socket, 0x2, out);
        Thread.sleep(100);
        FakeWs.send(socket, 0x8, new byte[] { 0x03, (byte) 0xe8 });
        return "ok";
    }

    /** A closed port fails at once; a port that takes the connection but never answers ends within CONNECT_MS. */
    private static void refusedAndSilent() throws Exception {
        long start = System.currentTimeMillis();
        boolean refused = false;
        try { DirectPipe.open("ws://127.0.0.1:" + closedPort() + "/peer/phone"); } catch (IOException expected) { refused = true; }
        check(refused && System.currentTimeMillis() - start < 1_000, "a closed port fails at once");
        try (ServerSocket silent = new ServerSocket()) {
            silent.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            List<Socket> held = Collections.synchronizedList(new ArrayList<>());
            Thread holder = new Thread(() -> { try { for (;;) held.add(silent.accept()); } catch (IOException closing) { /* test ends */ } }, "silent-pc");
            holder.setDaemon(true);
            holder.start();
            long asked = System.currentTimeMillis();
            boolean ended = false;
            try { DirectPipe.open("ws://127.0.0.1:" + silent.getLocalPort() + "/peer/phone"); } catch (IOException expected) { ended = true; }
            long took = System.currentTimeMillis() - asked;
            check(ended && took >= DirectPipe.CONNECT_MS - 100 && took < DirectPipe.CONNECT_MS + 1_000, "a silent port ends after about CONNECT_MS (" + took + " ms)");
            for (Socket socket : held) socket.close();
        }
    }

    private static int closedPort() throws IOException {
        try (ServerSocket probe = new ServerSocket()) {
            probe.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            return probe.getLocalPort();
        }
    }

    private static Route.Opener after(long ms, Pipe pipe) {
        return () -> { sleep(ms); return pipe; };
    }

    private static Route.Opener failing(long ms) {
        return () -> { sleep(ms); throw new IOException("no answer"); };
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
    }

    private static final class FakePipe implements Pipe {
        final String name;
        final boolean direct;
        volatile boolean closed;
        FakePipe(String name, boolean direct) { this.name = name; this.direct = direct; }
        @Override public void listen(Pipe.Listener listener) {}
        @Override public boolean isClosed() { return closed; }
        @Override public void sendText(String text) {}
        @Override public void sendBinary(byte[] data) {}
        @Override public void close() { closed = true; }
        @Override public boolean direct() { return direct; }
    }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
    }
}
