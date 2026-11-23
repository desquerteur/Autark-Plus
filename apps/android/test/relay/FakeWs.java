// Owns: a tiny WebSocket server on 127.0.0.1 for the relay host tests (B-084) – the upgrade, unmasked server frames,
// reading the phone's masked frames, and a meeting-server stand-in that says challenge/ready and answers pings or not.
// Never: a real meeting server (protocol checks, pins, tunnels) or anything beyond loopback.
package com.teydralab.autark.android.relay;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

final class FakeWs implements AutoCloseable {
    /** What the server does with one accepted connection. */
    enum Mode { UPGRADE_ONLY, RELAY_ANSWERS, RELAY_SILENT, REFUSE }

    final ServerSocket server;
    final AtomicInteger accepted = new AtomicInteger();
    final LinkedBlockingQueue<Long> acceptTimes = new LinkedBlockingQueue<>();
    final LinkedBlockingQueue<Integer> opcodes = new LinkedBlockingQueue<>();
    volatile Socket last;
    private final Mode mode;

    FakeWs(Mode mode) throws IOException {
        this.mode = mode;
        server = new ServerSocket();
        server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
        Thread thread = new Thread(this::acceptLoop, "fake-ws");
        thread.setDaemon(true);
        thread.start();
    }

    String url() { return "ws://127.0.0.1:" + server.getLocalPort() + "/relay"; }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket socket = server.accept();
                accepted.incrementAndGet();
                acceptTimes.offer(System.currentTimeMillis());
                last = socket;
                if (mode == Mode.REFUSE) { socket.close(); continue; }
                Thread worker = new Thread(() -> serve(socket), "fake-ws-conn");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException error) { return; }
        }
    }

    private void serve(Socket socket) {
        try {
            String head = WebSocketClient.readHead(socket.getInputStream());
            String key = "";
            for (String line : head.split("\r\n")) if (line.toLowerCase(Locale.ROOT).startsWith("sec-websocket-key:")) key = line.substring(18).trim();
            String accept = Crypto.b64urlStd(java.security.MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
            OutputStream out = socket.getOutputStream();
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            if (mode == Mode.UPGRADE_ONLY) return; // the test drives this socket itself
            send(socket, 0x1, "{\"t\":\"challenge\",\"n\":\"n1\"}".getBytes(StandardCharsets.UTF_8));
            DataInputStream in = new DataInputStream(socket.getInputStream());
            boolean ready = false;
            for (;;) {
                int[] op = new int[1];
                byte[] payload = read(in, op);
                opcodes.offer(op[0]);
                if (!ready && op[0] == 0x1) { ready = true; send(socket, 0x1, "{\"t\":\"ready\",\"online\":[]}".getBytes(StandardCharsets.UTF_8)); }
                else if (op[0] == 0x9 && mode == Mode.RELAY_ANSWERS) send(socket, 0xA, payload);
                else if (op[0] == 0x8) { socket.close(); return; }
            }
        } catch (Exception error) {
            try { socket.close(); } catch (IOException ignored) { /* closing */ }
        }
    }

    /** One unmasked server frame. */
    static synchronized void send(Socket socket, int opcode, byte[] payload) throws IOException {
        OutputStream out = socket.getOutputStream();
        out.write(0x80 | opcode);
        if (payload.length < 126) out.write(payload.length);
        else { out.write(126); out.write(payload.length >>> 8); out.write(payload.length & 0xff); }
        out.write(payload);
        out.flush();
    }

    /** One masked client frame; its opcode lands in op[0]. */
    static byte[] read(DataInputStream in, int[] op) throws IOException {
        int first = in.readUnsignedByte();
        int second = in.readUnsignedByte();
        op[0] = first & 0x0f;
        long length = second & 0x7f;
        if (length == 126) length = in.readUnsignedShort();
        else if (length == 127) length = in.readLong();
        byte[] mask = new byte[4];
        if ((second & 0x80) != 0) in.readFully(mask);
        byte[] payload = new byte[(int) length];
        in.readFully(payload);
        for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        return payload;
    }

    @Override public void close() throws IOException {
        server.close();
        Socket socket = last;
        if (socket != null) socket.close();
    }
}
