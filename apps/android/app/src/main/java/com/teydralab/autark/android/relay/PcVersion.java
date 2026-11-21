// Owns: learning which Autark version a PC runs, with one small request over its new channel (B-084 M1) – stream 0 of
// the stream protocol (rendezvous/phone.ts; the local entrance numbers its streams from 1) carries one bearer
// `POST /rpc` `system.info` with this phone's own token to the PC's own runtime port, and the answer's `version` comes
// back – and ordering two versions (0.3.10 > 0.3.9 > 0.3.9-local.2 > 0.3.9-local.1; an unknown one is the oldest).
// Never: keeps the channel's stream open after the answer, half-closes before it (the PC would cut the request), or
// sends anything but that one request.
package com.teydralab.autark.android.relay;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class PcVersion {
    /** The stream number of this request; the local entrance's streams start at 1. */
    static final int STREAM = 0;
    private static final int MAX_ANSWER = 64 * 1024;

    private final Consumer<Map<String, Object>> send;
    private final ByteArrayOutputStream answer = new ByteArrayOutputStream();
    private final CountDownLatch ended = new CountDownLatch(1);

    /** `send`: a message onto the channel (PeerChannel.send). */
    PcVersion(Consumer<Map<String, Object>> send) { this.send = send; }

    /** True for a message of this request's stream (the channel's listener hands it to deliver). */
    static boolean mine(Map<String, Object> message) { return Json.num(message, "s", -1) == STREAM; }

    /** The PC's version, or null when it did not answer within `timeoutMs` or the answer has none. */
    String fetch(String token, long timeoutMs) {
        byte[] body = Json.write(Json.map("id", 1, "method", "system.info")).getBytes(StandardCharsets.UTF_8);
        String head = "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer " + token + "\r\nContent-Type: application/json\r\n"
                + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        byte[] request = new byte[head.length() + body.length];
        System.arraycopy(head.getBytes(StandardCharsets.US_ASCII), 0, request, 0, head.length());
        System.arraycopy(body, 0, request, head.length(), body.length);
        send.accept(Json.map("t", "o", "s", STREAM));
        send.accept(Json.map("t", "d", "s", STREAM, "b", Base64.getEncoder().encodeToString(request)));
        boolean done;
        try { done = ended.await(timeoutMs, TimeUnit.MILLISECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); done = false; }
        if (!done) send.accept(Json.map("t", "e", "s", STREAM)); // the PC still holds the request: it ends there now
        byte[] whole;
        synchronized (answer) { whole = answer.toByteArray(); }
        return versionOf(new String(whole, StandardCharsets.UTF_8));
    }

    /** A message of stream 0 from the PC: its bytes or its end. */
    void deliver(Map<String, Object> message) {
        String type = Json.str(message, "t");
        if ("e".equals(type)) { ended.countDown(); return; }
        if (!"d".equals(type) || Json.str(message, "b") == null) return;
        byte[] data;
        try { data = Base64.getDecoder().decode(Json.str(message, "b")); } catch (IllegalArgumentException error) { return; }
        // No acknowledgement: the answer is far below the PC's window, and the reader thread this runs on never sends.
        synchronized (answer) { if (answer.size() + data.length <= MAX_ANSWER) answer.write(data, 0, data.length); }
    }

    /** The `result.version` of an HTTP 200 answer with a JSON body, or null. */
    static String versionOf(String response) {
        int split = response.indexOf("\r\n\r\n");
        if (split < 0 || !response.startsWith("HTTP/1.1 200")) return null;
        try {
            Object result = Json.object(response.substring(split + 4).trim()).get("result");
            if (!(result instanceof Map)) return null;
            @SuppressWarnings("unchecked") String version = Json.str((Map<String, Object>) result, "version");
            return version != null && version.matches("[0-9A-Za-z.+-]{1,64}") ? version : null;
        } catch (IllegalArgumentException error) { return null; }
    }

    /** Orders versions like semver: numbers first, then a release above its pre-releases; null is the oldest. */
    static int compare(String a, String b) {
        if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1;
        String[] x = a.split("\\+", 2)[0].split("-", 2), y = b.split("\\+", 2)[0].split("-", 2);
        int core = parts(x[0], y[0]);
        if (core != 0) return core;
        if (x.length != y.length) return x.length < y.length ? 1 : -1; // 0.3.9 > 0.3.9-local.1
        return x.length == 1 ? 0 : parts(x[1], y[1]);
    }

    /** Dot-separated identifiers: numbers by value, below words; words by text; a shorter list first. */
    private static int parts(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            if (i >= x.length || i >= y.length) return i >= x.length ? -1 : 1;
            boolean nx = x[i].matches("\\d{1,9}"), ny = y[i].matches("\\d{1,9}");
            int c = nx && ny ? Integer.compare(Integer.parseInt(x[i]), Integer.parseInt(y[i])) : nx != ny ? (nx ? -1 : 1) : x[i].compareTo(y[i]);
            if (c != 0) return c;
        }
        return 0;
    }
}
