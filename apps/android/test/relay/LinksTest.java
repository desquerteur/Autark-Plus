// Owns: the phone's links to all PCs of its company on a host JVM (B-084 M1) with fake channels – every online PC gets
// one (at most PcLinks.CAP), the page uses the newest version (the first paired among equals) and stays put on a tie,
// moves at once when its PC drops, the picker's PC wins while it is up, a PC that refused the page's token is passed
// over while another has not (each refuses once, the page never circles), a failed PC waits its backoff; PcVersion's
// ordering, its one request over stream 0 against a fake PC, and the pin comparison behind updatePcs.
// Never: a real tunnel or handshake (ReconnectTest and a phone do that).
package com.teydralab.autark.android.relay;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class LinksTest {
    private static int assertions;

    /** A channel stand-in: open until closed. */
    static final class Fake {
        final String name;
        boolean closed;
        Fake(String name) { this.name = name; }
    }

    public static void main(String[] args) throws Exception {
        allOnlineLinked();
        newestChosen();
        failover();
        preferWins();
        refusals();
        cap();
        retry();
        versions();
        fetch();
        pins();
        System.out.println(assertions + " multi-PC link assertions passed.");
    }

    private static PcLinks<Fake> links() { return new PcLinks<>(fake -> fake.closed); }

    private static List<String> fps(int n) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add("pc" + i);
        return out;
    }

    private static void allOnlineLinked() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("notebook", "server", "office");
        Set<String> online = new HashSet<>(Arrays.asList("notebook", "server"));
        List<String> open = links.toOpen(order, online::contains, 0);
        check(open.equals(Arrays.asList("notebook", "server")), "every online pinned PC gets a channel, in pin order: " + open);
        for (String fp : open) links.put(fp, new Fake(fp), "0.3.5");
        check(links.toOpen(order, online::contains, 0).isEmpty(), "a PC with an open channel is not opened again");
        online.add("office");
        check(links.toOpen(order, online::contains, 0).equals(Arrays.asList("office")), "a PC that comes online later is linked too");
        check(links.live() == 2 && links.live("server") && !links.live("office"), "live() counts the open channels");
    }

    private static void newestChosen() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("notebook", "server");
        Fake notebook = new Fake("notebook"), server = new Fake("server");
        links.put("notebook", notebook, "0.3.4");
        links.put("server", server, "0.3.5-local.1");
        check(links.pick(order, null) == server, "the page uses the PC with the newest version, not the first paired");
        check("server".equals(links.usedPc()) && "0.3.5-local.1".equals(links.usedVersion()), "usedPc/usedVersion name the page's PC");
        PcLinks<Fake> tie = links();
        Fake a = new Fake("a"), b = new Fake("b");
        tie.put("b", b, "0.3.5");
        tie.put("a", a, "0.3.5");
        check(tie.pick(Arrays.asList("a", "b"), null) == a, "among equal versions the one paired first is used");
        check(tie.pick(Arrays.asList("b", "a"), null) == a, "a new pin order alone does not move the page (equal versions)");
        PcLinks<Fake> unknown = links();
        Fake old = new Fake("old"), silent = new Fake("silent");
        unknown.put("silent", silent, null);
        unknown.put("old", old, "0.3.4");
        check(unknown.pick(Arrays.asList("silent", "old"), null) == old, "a PC that did not say its version ranks below any known one");
        Fake newer = new Fake("newer");
        links.put("notebook", newer, "0.3.9");
        check(links.pick(order, null) == newer, "a PC linked later with a newer version takes the page");
    }

    private static void failover() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("notebook", "server");
        Fake notebook = new Fake("notebook"), server = new Fake("server");
        links.put("notebook", notebook, "0.3.4");
        links.put("server", server, "0.3.5");
        check(links.pick(order, null) == server, "server first (newest)");
        server.closed = true;
        check(links.used() == null, "a closed channel is no longer the page's");
        check(links.pick(order, null) == notebook, "the page moves to the other live channel at once");
        check(links.prune(order).isEmpty() && links.live() == 1, "prune forgets the closed channel");
        Fake back = new Fake("server again");
        links.put("server", back, "0.3.5");
        check(links.pick(order, null) == back, "the newer PC back online takes the page again");
        List<Fake> gone = links.prune(Arrays.asList("server"));
        check(gone.size() == 1 && gone.get(0) == notebook, "a PC no longer pinned is handed back to be closed");
        back.closed = true;
        check(links.pick(Arrays.asList("server"), null) == null && links.usedPc() == null, "no channel left: no page PC");
    }

    private static void preferWins() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("notebook", "server");
        Fake notebook = new Fake("notebook"), server = new Fake("server");
        links.put("notebook", notebook, "0.3.4");
        links.put("server", server, "0.3.5");
        check(links.pick(order, "notebook") == notebook, "the picker's PC wins over the newer one");
        notebook.closed = true;
        check(links.pick(order, "notebook") == server, "while the picked PC is offline the page uses the newest other");
        Fake back = new Fake("notebook again");
        links.put("notebook", back, "0.3.4");
        check(links.pick(order, "notebook") == back, "the picked PC takes the page again once it is linked");
        check(links.pick(order, "unknown") == server || links.usedPc() != null, "a preference for a PC without a channel changes nothing");
    }

    // 16.11.2026 (F15/F22): a PC that refuses the page's token (4401) gives the page to the next PC that has not refused.
    private static void refusals() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("notebook", "server", "office");
        Fake notebook = new Fake("notebook"), server = new Fake("server");
        links.put("notebook", notebook, "0.3.4");
        links.put("server", server, "0.3.9");
        check(links.pick(order, null) == server, "the newest PC has the page");
        check(links.refuse("server") && !links.refuse("server"), "a refusal is news once");
        check(links.pick(order, null) == notebook, "after the refusal the page moves to the PC that has not refused");
        check(links.pick(order, null) == notebook, "and stays there: the newer refused PC does not take it back");
        check(links.refuse("notebook"), "the second PC refuses too");
        check(links.pick(order, null) == notebook, "every linked PC refused: the page stays where it is (it says 'Not paired')");
        Fake office = new Fake("office");
        links.put("office", office, "0.3.1");
        check(links.pick(order, null) == office, "a PC linked later that has not refused takes the page, older version or not");
        links.refuse("office");
        check(links.pick(order, null) == office, "each PC refuses at most once: no circling, the page stays");
        check(links.forgive("server") && !links.forgive("server"), "the person's pick forgives a refusal once");
        check(links.pick(order, "server") == server, "the picked PC gets the page again");
        check(!links.refuse(null), "no page PC: nothing to refuse");
        PcLinks<Fake> picked = links();
        Fake a = new Fake("a"), b = new Fake("b");
        picked.put("a", a, "0.3.9");
        picked.put("b", b, "0.3.9");
        check(picked.pick(Arrays.asList("a", "b"), "a") == a, "the picker's PC first");
        picked.refuse("a");
        check(picked.pick(Arrays.asList("a", "b"), "a") == b, "a picked PC that refused gives the page to one that has not");
    }

    private static void cap() {
        PcLinks<Fake> links = links();
        List<String> order = fps(12);
        List<String> open = links.toOpen(order, fp -> true, 0);
        check(open.size() == PcLinks.CAP && PcLinks.CAP == 8, "at most 8 PCs are linked at once (" + open.size() + ")");
        for (String fp : open) links.put(fp, new Fake(fp), "0.3.5");
        check(links.toOpen(order, fp -> true, 0).isEmpty(), "with 8 open channels no further PC is opened");
        links.all().get(0).closed = true;
        List<String> next = links.toOpen(order, fp -> true, 0);
        check(next.size() == 1 && next.get(0).equals("pc0"), "a closed slot is filled again, in pin order: " + next);
    }

    private static void retry() {
        PcLinks<Fake> links = links();
        List<String> order = Arrays.asList("a", "b");
        links.failed("a", 1_000);
        check(links.toOpen(order, fp -> true, 1_100).equals(Arrays.asList("b")), "a failed PC waits its backoff, the others do not");
        check(links.nextRetry(1_100) == 400, "nextRetry is the time until the failed PC is due (" + links.nextRetry(1_100) + ")");
        check(links.toOpen(order, fp -> true, 1_500).contains("a"), "after 0.5 s the failed PC is tried again");
        links.failed("a", 2_000);
        check(links.nextRetry(2_000) == 1_000, "the second failure waits 1 s");
        links.retryNow();
        check(links.toOpen(order, fp -> true, 2_000).contains("a") && links.nextRetry(2_000) == Long.MAX_VALUE, "check() makes every failed PC due at once");
        links.failed("a", 0);
        check(links.nextRetry(10_000) == Long.MAX_VALUE, "a due PC that is offline never makes the loop spin");
        links.retryNow();
        for (int i = 0; i < 6; i++) links.failed("a", 0);
        check(links.nextRetry(0) == 10_000, "with no channel up a failing PC keeps the 10 s step (" + links.nextRetry(0) + ")");
        links.put("b", new Fake("b"), "0.3.5");
        links.failed("a", 0);
        check(links.nextRetry(0) == PcLinks.SPARE_MS, "while the page has a PC, one that keeps failing waits a minute (" + links.nextRetry(0) + ")");
        links.retryNow();
        links.failed("a", 0);
        check(links.nextRetry(0) == 500, "after check() the backoff starts over at 0.5 s");
    }

    private static void versions() {
        String[] ascending = { null, "0.3.4", "0.3.5-local.1", "0.3.5-local.2", "0.3.5-local.10", "0.3.5", "0.3.9", "0.3.10", "1.0.0-rc.1", "1.0.0" };
        for (int i = 0; i < ascending.length; i++) {
            for (int j = 0; j < ascending.length; j++) {
                int c = PcVersion.compare(ascending[i], ascending[j]);
                check(Integer.signum(c) == Integer.signum(Integer.compare(i, j)), ascending[i] + " vs " + ascending[j] + " = " + c);
            }
        }
        check(PcVersion.compare("0.3.5+abc", "0.3.5") == 0, "build metadata is ignored");
        check(PcVersion.versionOf("HTTP/1.1 200 OK\r\nContent-Length: 40\r\n\r\n{\"id\":1,\"result\":{\"version\":\"0.3.5-local.1\",\"platform\":\"win32\"}}").equals("0.3.5-local.1"), "versionOf reads result.version");
        check(PcVersion.versionOf("HTTP/1.1 401 Unauthorized\r\n\r\n{\"id\":0,\"error\":{}}") == null, "a refused call has no version");
        check(PcVersion.versionOf("HTTP/1.1 200 OK\r\n\r\nnot json") == null, "a body that is not JSON has no version");
        check(PcVersion.versionOf("HTTP/1.1 200 OK\r\n\r\n{\"result\":{\"version\":\"<script>\"}}") == null, "an odd version string is not taken");
    }

    /** The one request over stream 0: the request bytes, the answer read back, and nothing after the PC's end. */
    private static void fetch() throws Exception {
        List<Map<String, Object>> sent = new ArrayList<>();
        PcVersion[] holder = new PcVersion[1];
        holder[0] = new PcVersion(message -> {
            synchronized (sent) { sent.add(wire(message)); }
            if ("d".equals(message.get("t"))) { // the fake PC answers on another thread, like the tunnel's reader
                Thread pc = new Thread(() -> {
                    String body = "{\"id\":1,\"result\":{\"version\":\"0.3.5-local.1\"}}";
                    String answer = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + body.length() + "\r\n\r\n" + body;
                    byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
                    int half = bytes.length / 2;
                    holder[0].deliver(wire(Json.map("t", "d", "s", 0, "b", Base64.getEncoder().encodeToString(Arrays.copyOfRange(bytes, 0, half)))));
                    holder[0].deliver(wire(Json.map("t", "d", "s", 0, "b", Base64.getEncoder().encodeToString(Arrays.copyOfRange(bytes, half, bytes.length)))));
                    holder[0].deliver(wire(Json.map("t", "e", "s", 0)));
                });
                pc.start();
            }
        });
        long started = System.currentTimeMillis();
        String version = holder[0].fetch("tok_123", 3_000);
        check("0.3.5-local.1".equals(version), "fetch returns the PC's version: " + version);
        check(System.currentTimeMillis() - started < 2_000, "fetch returns when the PC ends the stream, not at the timeout");
        synchronized (sent) {
            check(sent.size() == 2 && "o".equals(sent.get(0).get("t")) && Json.num(sent.get(0), "s", -1) == 0, "stream 0 opens, one data message, no half-close: " + sent.size());
            String request = new String(Base64.getDecoder().decode(Json.str(sent.get(1), "b")), StandardCharsets.UTF_8);
            check(request.startsWith("POST /rpc HTTP/1.1\r\n") && request.contains("Authorization: Bearer tok_123\r\n") && request.endsWith("{\"id\":1,\"method\":\"system.info\"}"), "the request is one bearer system.info call");
        }
        check(PcVersion.mine(wire(Json.map("t", "d", "s", 0))) && !PcVersion.mine(wire(Json.map("t", "d", "s", 1))), "only stream 0 is the version request's");
        List<Map<String, Object>> quiet = new ArrayList<>();
        String none = new PcVersion(message -> quiet.add(wire(message))).fetch("tok", 300);
        check(none == null && quiet.size() == 3 && "e".equals(quiet.get(2).get("t")), "a PC that never answers: null after the timeout and the stream ended");
    }

    private static void pins() {
        PhoneConnection.Pc a = new PhoneConnection.Pc("a", "ka", "Notebook", "d1"), b = new PhoneConnection.Pc("b", "kb", "Server", "d2");
        PhoneConnection.Pc renamed = new PhoneConnection.Pc("a", "ka", "Laptop", "d1");
        check(PhonePairing.samePins(Arrays.asList(a, b), Arrays.asList(b, renamed)), "order and names aside the pins are the same (no re-registration)");
        check(!PhonePairing.samePins(Arrays.asList(a), Arrays.asList(a, b)), "a new PC is a new pin");
    }

    /** A message as the channel carries it (numbers come back as JSON numbers). */
    private static Map<String, Object> wire(Map<String, Object> message) { return Json.object(Json.write(message)); }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
    }
}
