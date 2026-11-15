// Owns: what the connect screen accepts – the PC's Remote ID, typed ("482 913 071") or as the QR's pair link
// (PAIR_LINK + the ID, apps/desktop/src/shared/api/methods-phone.ts PHONE_PAIR_LINK; Android App Links open it here) –
// and the origin comparison for the local entrance (http://127.0.0.1:<port>); scanned(): what a QR or picture (pair/
// scanner, photo strip) may carry. Never: persists what was typed, or takes a pair link of another host.
package com.teydralab.autark.android;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class ConnectionAddress {
    /** Autark's own meeting server (apps/desktop/src/shared/model/relay.ts DEFAULT_RELAY). */
    public static final String DEFAULT_RELAY ="wss://telecoding-relay.onrender.com/autark";
    /** The QR on the PC: this plus the Remote ID (B-084: the site openautark.com). */
    static final String PAIR_LINK = "https://openautark.com/pair/#";
    /** QR codes of PCs before B-084 (the old Meta Jarvis address, which now forwards to openautark.com). */
    static final String META_PAIR_LINK = "https://metajarvis.teydralab.com/autark/pair/#";
    /** The spelling before B-078's site page (no slash before #); older QR codes still carry it. */
    static final String OLD_PAIR_LINK = "https://metajarvis.teydralab.com/autark/pair#";

    private ConnectionAddress() {}

    /** Nine digits, spaces or dashes allowed ("482 913 071"), or the pair link that carries them. */
    public static String remoteId(String text) {
        String value = text == null ? "" : text.trim();
        int hash = value.lastIndexOf('#');
        if (hash >= 0 && (value.contains("/pair/#") || value.contains("/pair#"))) value = value.substring(hash + 1);
        String digits = value.replaceAll("[\\s-]", "");
        if (!digits.matches("\\d{9}")) throw new IllegalArgumentException("The Remote ID has nine digits (Settings → Devices on the PC).");
        return digits;
    }

    /** The Remote ID of an opened pair link (App Links: https://openautark.com/pair/#<id>, or an older PC's), else null. */
    public static String fromLink(String url) {
        if (url == null || !(url.startsWith(PAIR_LINK) || url.startsWith(META_PAIR_LINK) || url.startsWith(OLD_PAIR_LINK))) return null;
        try { return remoteId(url); } catch (IllegalArgumentException error) { return null; }
    }

    /** A scanned QR's text: the pair link of this host, or the nine digits alone ("482 913 071"); anything else null. */
    public static String scanned(String text) {
        String value = text == null ? "" : text.trim();
        if (!value.matches("[\\d\\s-]+")) return fromLink(value);
        try { return remoteId(value); } catch (IllegalArgumentException error) { return null; }
    }

    static boolean sameOrigin(String origin, String url) {
        if (origin == null || url == null) return false;
        try { return origin.equals(origin(new URI(url))); }
        catch (URISyntaxException | IllegalArgumentException error) { return false; }
    }

    private static String origin(URI uri) throws URISyntaxException {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!(scheme.equals("https") || scheme.equals("http")) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getPort() == 0 || uri.getPort() > 65535) throw new URISyntaxException("", "web origin required");
        int port = uri.getPort() == (scheme.equals("https") ? 443 : 80) ? -1 : uri.getPort();
        return new URI(scheme, null, uri.getHost().toLowerCase(Locale.ROOT), port, null, null, null).toASCIIString();
    }
}
