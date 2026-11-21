// Owns: this phone's own socket straight to a PC's peer listener (F29 stage 1, 16.11.2026) – `<address>/peer/phone`
// as ws:// or wss:// (the PC's LAN, tailnet, router-mapped or IPv6 address from phoneUse.attach) – as a Pipe: plain text
// frames for the handshake, binary for the encrypted channel, a PC's 8 MB frames like a tunnel. The PC pings it every
// 30 s, as the meeting server pings its link; checkAlive() ends it after 65 s without a frame, probe() within 2 s when a
// ping goes unanswered (resume, a network change).
// Never: decides trust (the pinned handshake in PeerChannel does), reconnects, or dials anything but http(s) addresses.
package com.teydralab.autark.android.relay;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public final class DirectPipe implements Pipe, WebSocketClient.Listener {
    /** A PC's channel frames are at most 8 MB (devices/channel.ts), the same as a tunnel joins. */
    static final int MAX_MESSAGE = 8 * 1024 * 1024 + 1024;
    /** One try per address: the TCP connect and the upgrade answer each within this. */
    static final int CONNECT_MS = 1_500;
    private static final long WATCHDOG_MS = 65_000;
    /** Addresses tried at once per PC (the PC lists at most 8). */
    static final int MAX_ADDRESSES = 8;

    private volatile WebSocketClient ws;
    private volatile Pipe.Listener listener;
    private volatile boolean closed;

    private DirectPipe() {}

    /** Opens `url` (ws://host:port/peer/phone); throws when nothing answers within CONNECT_MS. */
    public static DirectPipe open(String url) throws IOException {
        DirectPipe pipe = new DirectPipe();
        pipe.ws = WebSocketClient.connect(url, pipe, MAX_MESSAGE, CONNECT_MS);
        if (pipe.closed) throw new IOException("The PC closed the direct connection.");
        return pipe;
    }

    /** `http(s)://host:port` → `ws(s)://host:port/peer/phone`; null for anything else. */
    static String url(String address) {
        if (address == null || address.length() > 200) return null;
        try {
            URI uri = URI.create(address);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("http") && !scheme.equals("https")) || uri.getHost() == null || uri.getRawUserInfo() != null) return null;
            return (scheme.equals("https") ? "wss" : "ws") + "://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "") + "/peer/phone";
        } catch (IllegalArgumentException error) { return null; }
    }

    /** One opener per usable address, in the PC's order. */
    static List<Route.Opener> openers(List<String> addresses) {
        List<Route.Opener> out = new ArrayList<>();
        for (String address : addresses) {
            String url = url(address);
            if (url != null && out.size() < MAX_ADDRESSES) out.add(() -> open(url));
        }
        return out;
    }

    @Override public void listen(Pipe.Listener listener) { this.listener = listener; }

    @Override public boolean isClosed() { return closed; }

    @Override public boolean direct() { return true; }

    @Override public void sendText(String text) {
        WebSocketClient socket = ws;
        try { if (socket != null) socket.sendText(text); } catch (IOException error) { socket.kill(); }
    }

    @Override public void sendBinary(byte[] data) {
        WebSocketClient socket = ws;
        try { if (socket != null) socket.sendBinary(data); } catch (IOException error) { socket.kill(); }
    }

    @Override public void close() {
        WebSocketClient socket = ws;
        if (socket != null) socket.close();
        else closed("closed");
    }

    @Override public void probe() {
        WebSocketClient socket = ws;
        if (closed || socket == null) return;
        long before = socket.frames();
        RelayLink.LATER.schedule(() -> { if (socket.frames() == before) socket.kill(); }, RelayLink.PROBE_MS, TimeUnit.MILLISECONDS);
        try { socket.ping(); } catch (IOException error) { socket.kill(); }
    }

    @Override public void checkAlive() {
        WebSocketClient socket = ws;
        if (!closed && socket != null && System.currentTimeMillis() - socket.lastFrameAt() > WATCHDOG_MS) socket.kill();
    }

    // ------------------------------------------------------------------ frames from the PC (reader thread)

    @Override public void text(String text) {
        Pipe.Listener target = listener;
        if (target != null) target.message(text.getBytes(java.nio.charset.StandardCharsets.UTF_8), true);
    }

    @Override public void binary(byte[] data) {
        Pipe.Listener target = listener;
        if (target != null) target.message(data, false);
    }

    @Override public void closed(String reason) {
        if (closed) return;
        closed = true;
        Pipe.Listener target = listener;
        if (target != null) target.closed();
    }
}
