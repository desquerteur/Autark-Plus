// Owns: what the phone's libwebrtc (relay/WebRtc, F25 stage 2) is set to, in one place a host test reads: per try one
// RTCConfiguration whose ICE servers are exactly the STUN URLs of the PC's offer – none at all for an empty list;
// libwebrtc adds no server of its own (its libraries name no STUN host) – with this phone's own candidates over UDP only
// (TCP candidates off), gathered once (no gathering in the background), one bundled transport and ECDSA for DTLS; and
// the logger every libwebrtc log line goes to, native and Java: it drops them all, at LS_NONE, so no candidate, address
// or SDP reaches logcat (injecting it also turns libwebrtc's own logcat output off).
// Never: names a STUN server itself, or turns libwebrtc's logcat output on.
package com.teydralab.autark.android.relay;

import java.util.ArrayList;
import java.util.List;
import org.webrtc.Loggable;
import org.webrtc.Logging;
import org.webrtc.PeerConnection;

final class WebRtcConfig {
    /** Where libwebrtc's log lines go: nowhere. */
    static final Loggable SILENT = (message, severity, tag) -> { };
    /** Only lines at this severity or above would reach SILENT – none (LS_NONE is above every real one). */
    static final Logging.Severity LOG_LEVEL = Logging.Severity.LS_NONE;

    private WebRtcConfig() {}

    /** The configuration of one try: the ICE servers are `stun` and nothing else. */
    static PeerConnection.RTCConfiguration of(List<String> stun) {
        List<PeerConnection.IceServer> servers = new ArrayList<>();
        if (!stun.isEmpty()) servers.add(PeerConnection.IceServer.builder(new ArrayList<>(stun)).createIceServer());
        PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(servers);
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        config.iceTransportsType = PeerConnection.IceTransportsType.ALL;
        config.tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED;
        config.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE;
        config.candidateNetworkPolicy = PeerConnection.CandidateNetworkPolicy.ALL;
        config.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE;
        config.rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE;
        config.keyType = PeerConnection.KeyType.ECDSA;
        config.iceCandidatePoolSize = 0;
        return config;
    }

    /** The type (host, srflx, prflx, relay) in a candidate line, else "other" – what a log line may say about it. */
    static String type(String line) {
        String[] parts = line == null ? new String[0] : line.trim().split("\\s+");
        for (int i = 0; i + 1 < parts.length; i++) if (parts[i].equals("typ")) return parts[i + 1].matches("host|srflx|prflx|relay") ? parts[i + 1] : "other";
        return "other";
    }
}
