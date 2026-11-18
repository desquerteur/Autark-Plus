// Owns: a WebRTC data channel as a Pipe (F25 stage 2, 16.11.2026), framed exactly as the PC's rendezvous/rtc-socket.ts:
// text (the handshake) as one string message; a binary channel frame in pieces [flags u8][bytes] – flags 1 (MORE) on
// every piece but the last, and such a piece carries exactly 16384 bytes; the last one 1–16384 – joined again here up
// to the channel's 8 MiB. A piece out of shape, text in the middle of a frame, a frame past 8 MiB or a send buffer past
// 16 MiB (that way is too slow: the tunnel takes over) ends it.
// Never: decides trust (PeerChannel runs the pinned handshake over it with the PC's key) or touches ICE (RtcWay does).
package com.teydralab.autark.android.relay;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public final class RtcPipe implements Pipe {
    /** The data channel this pipe sends through (relay/WebRtc on a phone, a stand-in in the tests). */
    public interface Wire {
        /** Hands one message to the data channel; false when it would not take it. */
        boolean send(byte[] data, boolean text);
        /** Bytes handed over and not yet sent. */
        long buffered();
        void close();
    }

    static final int PIECE = 16 * 1024;
    private static final int MORE = 1;
    static final int MAX_MESSAGE = 8 * 1024 * 1024 + 1024;
    static final long MAX_BUFFERED = 16L * 1024 * 1024;

    private final Wire wire;
    private final ByteArrayOutputStream parts = new ByteArrayOutputStream();
    private volatile Pipe.Listener listener;
    private volatile boolean closed;

    RtcPipe(Wire wire) { this.wire = wire; }

    @Override public void listen(Pipe.Listener listener) { this.listener = listener; }

    @Override public boolean isClosed() { return closed; }

    /** Straight to the PC, as a direct socket is (the status line says "directly"). */
    @Override public boolean direct() { return true; }

    @Override public synchronized void sendText(String text) {
        if (!closed && !wire.send(text.getBytes(StandardCharsets.UTF_8), true)) close();
    }

    @Override public synchronized void sendBinary(byte[] data) {
        if (closed || data.length == 0) return;
        if (wire.buffered() > MAX_BUFFERED) { close(); return; }
        int offset = 0;
        while (offset < data.length) {
            int length = Math.min(PIECE, data.length - offset);
            byte[] piece = new byte[1 + length];
            piece[0] = (byte) (offset + length < data.length ? MORE : 0);
            System.arraycopy(data, offset, piece, 1, length);
            if (!wire.send(piece, false)) { close(); return; }
            offset += length;
        }
    }

    /** A message from the data channel (the engine's thread, one at a time). */
    void receive(byte[] data, boolean text) {
        if (closed) return;
        if (text) {
            if (parts.size() > 0) { close(); return; } // text in the middle of a frame
            deliver(data, true);
            return;
        }
        int payload = data.length - 1;
        boolean more = payload >= 0 && data[0] == MORE;
        if (payload < 1 || payload > PIECE || (data[0] & ~MORE) != 0 || (more && payload != PIECE)) { close(); return; }
        if (parts.size() + payload > MAX_MESSAGE) { close(); return; }
        parts.write(data, 1, payload);
        if (more) return;
        byte[] whole = parts.toByteArray();
        parts.reset();
        deliver(whole, false);
    }

    private void deliver(byte[] data, boolean text) {
        Pipe.Listener target = listener;
        if (target != null) target.message(data, text);
    }

    @Override public void close() {
        if (closed) return;
        try { wire.close(); } catch (RuntimeException ignored) { /* already gone */ }
        ended();
    }

    /** The data channel closed (or this pipe closed it). */
    void ended() {
        if (closed) return;
        closed = true;
        Pipe.Listener target = listener;
        if (target != null) target.closed();
    }
}
