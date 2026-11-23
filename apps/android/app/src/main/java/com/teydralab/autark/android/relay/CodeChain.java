// Owns: checking the person code (B-084 decision 13, format .local/b084/notes/W4-format.md, as remote/code.ts) – a
// device answers for a Remote ID when it is that ID's own key, or when its chain {root, links:[{pub, sig}]} runs from
// the root key of that ID to it, each link signed by the key before it over "wf-code-v1|" + the member's fingerprint.
// Never: trusts a chain longer than 8 links, signs anything, or stores a chain.
package com.teydralab.autark.android.relay;

import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class CodeChain {
    static final int MAX_LINKS = 8;

    private CodeChain() {}

    /** True when the device `fingerprintHex` may answer for `remoteId` (its own ID, or a chain that proves it). */
    public static boolean belongs(String remoteId, String fingerprintHex, String chainJson) {
        if (remoteId == null || fingerprintHex == null) return false;
        String fp = fingerprintHex.toLowerCase(Locale.ROOT);
        if (Crypto.remoteId(fp).equals(remoteId)) return true;
        if (chainJson == null) return false;
        try {
            Object parsed = Json.parse(chainJson);
            if (!(parsed instanceof Map)) return false;
            Map<?, ?> chain = (Map<?, ?>) parsed;
            byte[] prev = key(chain.get("root"), 32);
            Object links = chain.get("links");
            if (prev == null || !(links instanceof List) || ((List<?>) links).size() > MAX_LINKS) return false;
            if (!Crypto.remoteId(Crypto.fingerprint(prev)).equals(remoteId)) return false;
            for (Object item : (List<?>) links) {
                if (!(item instanceof Map)) return false;
                byte[] pub = key(((Map<?, ?>) item).get("pub"), 32);
                byte[] sig = key(((Map<?, ?>) item).get("sig"), 64);
                if (pub == null || sig == null || !Crypto.verify(prev, Crypto.utf8("wf-code-v1|" + Crypto.fingerprint(pub)), sig)) return false;
                prev = pub;
            }
            return Crypto.fingerprint(prev).equals(fp);
        } catch (RuntimeException error) { return false; }
    }

    /** base64url text of exactly `length` bytes, else null. */
    private static byte[] key(Object value, int length) {
        if (!(value instanceof String) || ((String) value).length() > 128) return null;
        byte[] raw = Crypto.fromB64url((String) value);
        return raw.length == length ? raw : null;
    }
}
