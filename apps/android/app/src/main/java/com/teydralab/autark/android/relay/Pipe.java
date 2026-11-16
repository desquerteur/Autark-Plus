// Owns: what PeerChannel runs over (F29 stage 1, 16.11.2026) – a tunnel through the meeting server (Tunnel) or this
// phone's own socket straight to the PC's peer listener (DirectPipe): text frames for the handshake, binary frames for
// the encrypted channel, close, and the liveness checks a direct socket needs itself.
// Never: decides trust (the pinned handshake in PeerChannel does) or which pipe is used (Route does).
package com.teydralab.autark.android.relay;

public interface Pipe {
    interface Listener {
        void message(byte[] data, boolean text);
        void closed();
    }

    void listen(Listener listener);

    boolean isClosed();

    void sendText(String text);

    void sendBinary(byte[] data);

    void close();

    /** True for a socket straight to the PC, false for a tunnel through the meeting server. */
    default boolean direct() { return false; }

    /** Pings now and ends the pipe when nothing answers within RelayLink.PROBE_MS (a tunnel's server link is probed itself). */
    default void probe() {}

    /** Ends a pipe silent for longer than its other end's pings allow (a tunnel's server link has its own watchdog). */
    default void checkAlive() {}
}
