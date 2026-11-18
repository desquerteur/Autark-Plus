// Owns: the phone's half of F25's signalling (stage 2, 16.11.2026; the PC's rendezvous/rtc.ts, v 1) as plain data –
// building hello, answer, cand and end; reading an offer (an id, SDP of at most 16 KiB, and from its ice list only stun:
// URLs, at most 4, so an empty list stays empty); and the address filter both directions take, the PC's allowedCandidate
// one step stricter: UDP only, an IP literal outside loopback, 0/8, link-local (169.254.169.254 too), multicast,
// broadcast and 240/4, :: and the IPv4-compatible range, 64:ff9b::/96, fe80::/10 and ff00::/8 (an IPv4-mapped address
// counts as its IPv4), a port of 1024 and up – and no name: an mDNS .local name would be resolved by libwebrtc before
// anything could check the address it stands for. At most 32 candidates count per try and direction.
// Never: sends anything itself (RtcWay does, only on the finished pinned channel), resolves a name, or puts an address
// into a log line (candidateType gives the type only).
package com.teydralab.autark.android.relay;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class RtcSignal {
    static final int VERSION = 1;
    static final int MAX_SDP = 16 * 1024;
    static final int MAX_CANDIDATES = 32;
    static final int MAX_STUN = 4;
    private static final int MAX_LINE = 512;
    private static final Set<String> NETS = new HashSet<>(Arrays.asList("wifi", "cell", "ethernet", "vpn", "other"));

    private RtcSignal() {}

    /** A PC's offer as the phone takes it: the SDP keeps only candidates the filter passes (at most 32). */
    static final class Offer {
        final String id;
        final String sdp;
        final List<String> stun;
        /** Candidate lines of the PC the filter left out (a count for the log, never the lines). */
        final int dropped;
        Offer(String id, String sdp, List<String> stun, int dropped) { this.id = id; this.sdp = sdp; this.stun = stun; this.dropped = dropped; }
    }

    static boolean mine(Map<String, Object> message) { return "rtc".equals(message.get("t")); }

    static Map<String, Object> hello(String net) {
        Map<String, Object> out = Json.map("t", "rtc", "v", VERSION, "op", "hello");
        if (net != null && NETS.contains(net)) out.put("net", net);
        return out;
    }

    static Map<String, Object> answer(String id, String sdp) { return Json.map("t", "rtc", "v", VERSION, "op", "answer", "id", id, "sdp", sdp); }

    static Map<String, Object> candidate(String id, String line) {
        return Json.map("t", "rtc", "v", VERSION, "op", "cand", "id", id, "c", Json.map("candidate", line, "sdpMid", "0", "sdpMLineIndex", 0));
    }

    static Map<String, Object> done(String id) { return Json.map("t", "rtc", "v", VERSION, "op", "cand", "id", id, "done", true); }

    static Map<String, Object> end(String id, String why) { return Json.map("t", "rtc", "v", VERSION, "op", "end", "id", id, "why", why); }

    /** The offer in `message`, or null when it is none this phone takes (another version, no id, SDP missing or past 16 KiB). */
    static Offer offer(Map<String, Object> message) {
        if (!"offer".equals(message.get("op")) || Json.num(message, "v", -1) != VERSION) return null;
        String id = Json.str(message, "id");
        String sdp = Json.str(message, "sdp");
        if (id == null || id.isEmpty() || id.length() > 64 || sdp == null || bytes(sdp) > MAX_SDP) return null;
        List<String> kept = new ArrayList<>();
        int dropped = 0;
        StringBuilder out = new StringBuilder();
        for (String line : sdp.split("\r?\n")) {
            if (line.isEmpty()) continue;
            if (line.startsWith("a=candidate:")) {
                if (kept.size() < MAX_CANDIDATES && candidateType(line) != null) kept.add(line);
                else { dropped++; continue; }
            }
            out.append(line).append("\r\n");
        }
        return new Offer(id, out.toString(), stun(message.get("ice")), dropped);
    }

    /** The STUN URLs of an offer's ice list ([{urls: [..] or ".."}]): stun: only, at most 4, in the PC's order. */
    static List<String> stun(Object ice) {
        if (!(ice instanceof List)) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (Object server : (List<?>) ice) {
            if (!(server instanceof Map)) continue;
            Object urls = ((Map<?, ?>) server).get("urls");
            List<?> each = urls instanceof List ? (List<?>) urls : urls instanceof String ? Collections.singletonList(urls) : Collections.emptyList();
            for (Object url : each) if (url instanceof String && stunUrl((String) url) && out.size() < MAX_STUN && !out.contains(url)) out.add((String) url);
        }
        return out;
    }

    /** stun:host or stun:host:port – no user, query or transport, at most 200 characters. */
    static boolean stunUrl(String url) {
        return url.length() <= 200 && url.matches("stun:[A-Za-z0-9.\\-]{1,190}(:[0-9]{1,5})?|stun:\\[[0-9A-Fa-f:.]{2,45}\\](:[0-9]{1,5})?");
    }

    /** The SDP without its candidate lines (they travel as cand messages through the same filter). */
    static String withoutCandidates(String sdp) {
        StringBuilder out = new StringBuilder();
        for (String line : sdp.split("\r?\n")) if (!line.isEmpty() && !line.startsWith("a=candidate:") && !line.equals("a=end-of-candidates")) out.append(line).append("\r\n");
        return out.toString();
    }

    /** The candidate lines of an SDP (without "a="). */
    static List<String> candidates(String sdp) {
        List<String> out = new ArrayList<>();
        for (String line : sdp.split("\r?\n")) if (line.startsWith("a=candidate:")) out.add(line.substring(2));
        return out;
    }

    /** The type (host, srflx, prflx, relay) of a UDP candidate line the filter passes, else null. */
    static String candidateType(String line) {
        if (line == null || line.length() > MAX_LINE) return null;
        String[] parts = line.trim().replaceFirst("^a=", "").split("\\s+");
        if (parts.length < 8 || !parts[0].startsWith("candidate:") || !parts[2].equalsIgnoreCase("udp") || !parts[6].equals("typ")) return null;
        int port;
        try { port = Integer.parseInt(parts[5]); } catch (NumberFormatException error) { return null; }
        if (!allowedAddress(parts[4], port)) return null;
        return parts[7].matches("host|srflx|prflx|relay") ? parts[7] : null;
    }

    /** An IP literal and port this phone sends checks to or names: outside the blocked ranges, port 1024–65535. */
    static boolean allowedAddress(String host, int port) {
        if (port < 1024 || port > 65535) return false;
        byte[] ip = ip(host);
        if (ip == null) return false;
        if (ip.length == 16) {
            if (prefix(ip, new byte[10], 80) && (ip[10] & 0xff) == 0xff && (ip[11] & 0xff) == 0xff) return allowedV4(Arrays.copyOfRange(ip, 12, 16)); // ::ffff:a.b.c.d
            if (prefix(ip, new byte[12], 96)) return false; // ::, ::1 and the IPv4-compatible range
            if (prefix(ip, new byte[] { 0, 0x64, (byte) 0xff, (byte) 0x9b, 0, 0, 0, 0, 0, 0, 0, 0 }, 96)) return false; // 64:ff9b::/96
            if ((ip[0] & 0xff) == 0xfe && (ip[1] & 0xc0) == 0x80) return false; // fe80::/10
            return (ip[0] & 0xff) != 0xff; // ff00::/8
        }
        return allowedV4(ip);
    }

    private static boolean allowedV4(byte[] ip) {
        int first = ip[0] & 0xff;
        if (first == 0 || first == 127 || first >= 224) return false; // 0/8, loopback, multicast 224/4, 240/4 and broadcast
        return !(first == 169 && (ip[1] & 0xff) == 254); // link-local, 169.254.169.254 too
    }

    private static boolean prefix(byte[] ip, byte[] start, int bits) {
        for (int i = 0; i < bits / 8; i++) if (ip[i] != start[i]) return false;
        return true;
    }

    /** The bytes of an IPv4 (four decimal parts) or IPv6 literal (an embedded IPv4 tail allowed), else null – never a lookup. */
    static byte[] ip(String text) {
        if (text == null || text.isEmpty() || text.length() > 45) return null;
        return text.indexOf(':') >= 0 ? ip6(text) : ip4(text);
    }

    private static byte[] ip4(String text) {
        String[] parts = text.split("\\.", -1);
        if (parts.length != 4) return null;
        byte[] out = new byte[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("[0-9]{1,3}") || (parts[i].length() > 1 && parts[i].charAt(0) == '0')) return null;
            int value = Integer.parseInt(parts[i]);
            if (value > 255) return null;
            out[i] = (byte) value;
        }
        return out;
    }

    private static byte[] ip6(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        if (!lower.matches("[0-9a-f:.]+")) return null;
        byte[] tail = null;
        int dot = lower.indexOf('.');
        if (dot >= 0) { // an IPv4 tail: a.b.c.d after the last colon
            int colon = lower.lastIndexOf(':');
            if (colon > dot) return null;
            tail = ip4(lower.substring(colon + 1));
            if (tail == null) return null;
            lower = lower.substring(0, colon + 1) + "0:0";
        }
        int gap = lower.indexOf("::");
        if (gap >= 0 && lower.indexOf("::", gap + 1) >= 0) return null;
        String[] head = gap < 0 ? lower.split(":", -1) : lower.substring(0, gap).isEmpty() ? new String[0] : lower.substring(0, gap).split(":", -1);
        String[] rest = gap < 0 ? new String[0] : lower.substring(gap + 2).isEmpty() ? new String[0] : lower.substring(gap + 2).split(":", -1);
        int groups = head.length + rest.length;
        if ((gap < 0 && groups != 8) || (gap >= 0 && groups > 7)) return null;
        byte[] out = new byte[16];
        if (!groups(head, out, 0) || !groups(rest, out, 16 - 2 * rest.length)) return null;
        if (tail != null) System.arraycopy(tail, 0, out, 12, 4);
        return out;
    }

    private static boolean groups(String[] parts, byte[] out, int at) {
        for (String part : parts) {
            if (!part.matches("[0-9a-f]{1,4}")) return false;
            int value = Integer.parseInt(part, 16);
            out[at++] = (byte) (value >>> 8);
            out[at++] = (byte) value;
        }
        return true;
    }

    static int bytes(String text) { return text.getBytes(StandardCharsets.UTF_8).length; }
}
