// Owns: the phone's libwebrtc – Threema's build of Google's WebRTC, ch.threema:webrtc-android (app/build.gradle, pinned
// exactly) – as the RtcEngine of the WebRTC way (F25 stage 2, 16.11.2026). It loads with the first try only, so a phone
// whose PC never offers never maps it; when its native library is missing (an ABI the APK leaves out) or fails to load,
// every try fails at once and the phone stays on its tunnel. Settings in WebRtcConfig: ICE servers exactly the offer's
// STUN list (none for an empty one), UDP only, gathered once; every libwebrtc log line, native and Java, to a logger
// that drops it, so no candidate or address reaches logcat. One answering peer connection per try; the PC's data
// channel is handed to RtcWay. A data channel only: the audio module libwebrtc makes is never started, no microphone.
// The only relay/* file besides NetworkWake with Android imports (the others compile on a host JVM for the tests).
// Never: logs through libwebrtc's logcat output (Logging.enableLogToDebugOutput), names a STUN server, or blocks
// libwebrtc's own threads (closing and freeing run on a thread of their own).
package com.teydralab.autark.android.relay;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.webrtc.CandidatePairChangeEvent;
import org.webrtc.DataChannel;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

public final class WebRtc implements RtcEngine {
    private static final long STEP_MS = 5_000;
    /** Closing and freeing, one after another, never on libwebrtc's own threads. */
    private static final ExecutorService FREE = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "autark-webrtc-free");
        thread.setDaemon(true);
        return thread;
    });
    private static PeerConnectionFactory factory;
    private static boolean missing;

    private final Context context;

    public WebRtc(Context context) { this.context = context.getApplicationContext(); }

    /** The one factory of this process, made on the first try. */
    private static synchronized PeerConnectionFactory factory(Context context) throws IOException {
        if (factory != null) return factory;
        if (missing) throw new IOException("WebRTC is not available on this phone.");
        try {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context)
                    .setInjectableLogger(WebRtcConfig.SILENT, WebRtcConfig.LOG_LEVEL)
                    .createInitializationOptions());
            factory = PeerConnectionFactory.builder().setOptions(new PeerConnectionFactory.Options()).createPeerConnectionFactory();
            return factory;
        } catch (RuntimeException | LinkageError error) { // no native library for this ABI, or it would not load
            missing = true;
            throw new IOException("WebRTC is not available on this phone.");
        }
    }

    @Override public String net() {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
        if (caps == null) return null;
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cell";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        return "other";
    }

    @Override public void log(String line) { android.util.Log.i("Autark", line); }

    @Override public Peer answer(String offer, List<String> stun, Events events) throws IOException {
        PeerConnectionFactory made = factory(context);
        Watch watch = new Watch(events);
        PeerConnection pc = made.createPeerConnection(WebRtcConfig.of(stun), watch);
        if (pc == null) throw new IOException("WebRTC refused the configuration.");
        Answer peer = new Answer(pc, watch);
        try {
            step(done -> pc.setRemoteDescription(done, new SessionDescription(SessionDescription.Type.OFFER, offer)));
            SessionDescription answer = step(done -> pc.createAnswer(done, new MediaConstraints()));
            step(done -> pc.setLocalDescription(done, answer));
            peer.sdp = answer.description;
            return peer;
        } catch (IOException error) {
            peer.close();
            throw error;
        }
    }

    private interface Call { void run(SdpObserver done); }

    /** One SDP step of libwebrtc, waited for (on RtcWay's answering thread, never libwebrtc's own). */
    private static SessionDescription step(Call call) throws IOException {
        CountDownLatch over = new CountDownLatch(1);
        AtomicReference<SessionDescription> made = new AtomicReference<>();
        AtomicReference<String> failure = new AtomicReference<>();
        call.run(new SdpObserver() {
            @Override public void onCreateSuccess(SessionDescription description) { made.set(description); over.countDown(); }
            @Override public void onSetSuccess() { over.countDown(); }
            @Override public void onCreateFailure(String error) { failure.set("create"); over.countDown(); }
            @Override public void onSetFailure(String error) { failure.set("set"); over.countDown(); }
        });
        try { if (!over.await(STEP_MS, TimeUnit.MILLISECONDS)) throw new IOException("WebRTC did not answer in time."); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException("Interrupted."); }
        if (failure.get() != null) throw new IOException("WebRTC could not " + failure.get() + " a description."); // its text may name an address
        return made.get();
    }

    /** One answering peer connection and the data channel the PC opens on it. */
    private static final class Answer implements Peer {
        final PeerConnection pc;
        final Watch watch;
        volatile String sdp;
        /** Held around every use of the data channel and its freeing: a send never meets freed native memory. */
        final Object lock = new Object();
        private boolean freed;

        Answer(PeerConnection pc, Watch watch) { this.pc = pc; this.watch = watch; watch.owner = this; }

        @Override public String sdp() { return sdp; }

        @Override public void close() {
            FREE.execute(() -> {
                synchronized (lock) {
                    if (freed) return;
                    freed = true; // from here no send reaches the data channel
                }
                try { pc.close(); } catch (RuntimeException ignored) { /* already closed */ }
                synchronized (lock) {
                    DataChannel channel = watch.channel;
                    try {
                        if (channel != null) { channel.unregisterObserver(); channel.dispose(); }
                        pc.dispose();
                    } catch (RuntimeException ignored) { /* already gone */ }
                }
            });
        }
    }

    /** libwebrtc's callbacks (its signaling thread) as RtcEngine events. */
    private static final class Watch implements PeerConnection.Observer {
        final Events events;
        volatile Answer owner;
        volatile DataChannel channel;
        private boolean opened;

        Watch(Events events) { this.events = events; }

        @Override public void onIceCandidate(IceCandidate candidate) { events.candidate(candidate.sdp); }

        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) events.gathered();
        }

        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) { events.ice(state.name().toLowerCase(java.util.Locale.ROOT)); }

        @Override public void onSelectedCandidatePairChanged(CandidatePairChangeEvent event) {
            events.pair(WebRtcConfig.type(event.local == null ? null : event.local.sdp), WebRtcConfig.type(event.remote == null ? null : event.remote.sdp));
        }

        @Override public void onDataChannel(DataChannel opened) {
            if (channel != null) { FREE.execute(() -> { opened.close(); opened.dispose(); }); return; } // one data channel per try
            channel = opened;
            opened.registerObserver(new DataChannel.Observer() {
                @Override public void onBufferedAmountChange(long previous) { }
                @Override public void onStateChange() { state(opened); }
                @Override public void onMessage(DataChannel.Buffer buffer) {
                    byte[] data = new byte[buffer.data.remaining()];
                    buffer.data.get(data);
                    events.message(data, !buffer.binary);
                }
            });
            state(opened); // it may be open already
        }

        private void state(DataChannel dc) {
            DataChannel.State now = dc.state();
            if (now == DataChannel.State.OPEN) {
                synchronized (this) { if (opened) return; opened = true; }
                events.open(dc.label(), wire(dc));
            } else if (now == DataChannel.State.CLOSED) events.closed();
        }

        private RtcPipe.Wire wire(DataChannel dc) {
            return new RtcPipe.Wire() {
                @Override public boolean send(byte[] data, boolean text) {
                    Answer peer = owner;
                    if (peer == null) return false;
                    synchronized (peer.lock) {
                        if (peer.freed) return false;
                        try { return dc.send(new DataChannel.Buffer(ByteBuffer.wrap(data), !text)); }
                        catch (RuntimeException gone) { return false; }
                    }
                }
                @Override public long buffered() {
                    Answer peer = owner;
                    if (peer == null) return 0;
                    synchronized (peer.lock) {
                        if (peer.freed) return 0;
                        try { return dc.bufferedAmount(); } catch (RuntimeException gone) { return 0; }
                    }
                }
                @Override public void close() {
                    Answer peer = owner;
                    if (peer != null) peer.close(); // the data channel ends with its peer connection
                }
            };
        }

        @Override public void onSignalingChange(PeerConnection.SignalingState state) { }
        @Override public void onIceConnectionReceivingChange(boolean receiving) { }
        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) { }
        @Override public void onAddStream(MediaStream stream) { }
        @Override public void onRemoveStream(MediaStream stream) { }
        @Override public void onRenegotiationNeeded() { }
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) { }
    }
}
