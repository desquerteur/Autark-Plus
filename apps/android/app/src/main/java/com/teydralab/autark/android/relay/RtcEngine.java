// Owns: what the WebRTC way (F25 stage 2, RtcWay) needs from libwebrtc – one answering peer connection per try with the
// ICE servers it is given, its candidates, ICE states and the PC's data channel – so the way's logic runs and is tested
// on a host JVM; relay/WebRtc is the phone's libwebrtc behind it, a stand-in plays it in the tests.
// Never: decides anything about the way (RtcWay does) or names an address in a log line.
package com.teydralab.autark.android.relay;

import java.io.IOException;
import java.util.List;

public interface RtcEngine {
    /** The phone's network for the PC's counts (wifi, cell, ethernet, vpn, other) or null. */
    String net();

    /** A peer connection with exactly `stun` as its ICE servers (none for an empty list), which took `offer` and answered
     *  it; its events follow on `events`. Throws when WebRTC is missing on this phone or refuses the offer. */
    Peer answer(String offer, List<String> stun, Events events) throws IOException;

    /** One line for the app's log (outcomes and candidate types only). */
    void log(String line);

    /** One peer connection. */
    interface Peer {
        /** The answer's SDP. */
        String sdp();
        /** Ends it on the engine's own thread; returns at once. */
        void close();
    }

    /** What a peer connection reports (its threads). */
    interface Events {
        /** A candidate of this phone, as its SDP line. */
        void candidate(String line);
        /** This phone's candidates are all out. */
        void gathered();
        /** ICE connection state: new, checking, connected, completed, disconnected, failed or closed. */
        void ice(String state);
        /** The PC's data channel is open. */
        void open(String label, RtcPipe.Wire wire);
        void message(byte[] data, boolean text);
        /** The data channel closed. */
        void closed();
        /** The types (host, srflx, prflx, relay) of the candidate pair in use. */
        void pair(String local, String remote);
    }
}
