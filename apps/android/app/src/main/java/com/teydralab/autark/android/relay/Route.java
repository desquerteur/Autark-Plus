// Owns: which pipe a channel to one PC runs over (F29 stage 1, 16.11.2026), like the PC's devices/reach.ts: the PC's
// direct addresses all at once – the first socket that opens within the window runs the pinned handshake, the later ones
// close as they open – and the tunnel through the meeting server when none opens in time or the handshake over the
// direct socket fails (another device on that address, a refusal). One pipe per PC at a time: the direct socket replaces
// the tunnel, it is never added to it.
// Never: retries, remembers a route, or decides trust (the handshake does).
package com.teydralab.autark.android.relay;

import java.io.IOException;
import java.util.List;

final class Route {
    interface Opener { Pipe open() throws IOException; }

    interface Handshake<C> { C run(Pipe pipe) throws IOException; }

    /** How long the direct addresses get before the tunnel is opened (a LAN answers in milliseconds). */
    static final long DIRECT_MS = DirectPipe.CONNECT_MS;

    private Route() {}

    /** The channel over the first direct pipe that opens and passes the handshake, else over `tunnel` (null: direct only, then it throws). */
    static <C> C open(List<Opener> direct, long windowMs, Opener tunnel, Handshake<C> handshake) throws IOException {
        Pipe pipe = direct.isEmpty() ? null : first(direct, windowMs);
        IOException failure = null;
        if (pipe != null) {
            try { return handshake.run(pipe); }
            catch (IOException | RuntimeException error) {
                pipe.close();
                failure = error instanceof IOException ? (IOException) error : new IOException(error.getMessage());
            }
        }
        if (tunnel == null) throw failure != null ? failure : new IOException("No direct address of the PC answered.");
        return handshake.run(tunnel.open());
    }

    /** The first of `opens` that opens within `windowMs` (each on a thread of its own), or null; the others close as they open. */
    static Pipe first(List<Opener> opens, long windowMs) {
        Object lock = new Object();
        Pipe[] won = new Pipe[1];
        boolean[] over = new boolean[1];
        int[] failed = new int[1];
        for (Opener open : opens) {
            Thread dial = new Thread(() -> {
                Pipe pipe = null;
                try { pipe = open.open(); } catch (IOException | RuntimeException ignored) { /* this address did not answer */ }
                synchronized (lock) {
                    if (pipe != null && won[0] == null && !over[0]) { won[0] = pipe; pipe = null; }
                    else if (pipe == null) failed[0]++;
                    lock.notifyAll();
                }
                if (pipe != null) pipe.close(); // a later one, or the window ended
            }, "autark-direct-dial");
            dial.setDaemon(true);
            dial.start();
        }
        long deadline = System.currentTimeMillis() + windowMs;
        synchronized (lock) {
            try {
                while (won[0] == null && failed[0] < opens.size()) {
                    long left = deadline - System.currentTimeMillis();
                    if (left <= 0) break;
                    lock.wait(left);
                }
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            over[0] = true;
            return won[0];
        }
    }
}
