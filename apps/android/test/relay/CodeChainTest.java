// Owns: the person-code chain check against W4's vector (B-084, .local/b084/notes/W4-format.md, node:crypto with seeds
// 0x01-0x04), so the phone accepts exactly the chains the PC side builds. Never: a network test.
package com.teydralab.autark.android.relay;

import java.util.Arrays;

public final class CodeChainTest {
    private static int assertions;

    public static void main(String[] args) {
        String root = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w";
        String a = "gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q";
        String b = "7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E";
        String rootFp = "34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e";
        String aFp = "6a3803d5f059902a1c6dafbc9ba4729212f7caac08634cc3ae76b27529f03827";
        String bFp = "b62e867fa2f33afe62d5d6b1642e1621d543307846b2a57b897e710919b76709";
        String fFp = "c5b940ed3f65c391965de8295fc5d25f474fa57b48d36eb10ad363b8539c1b79";
        String linkA = "{\"pub\":\"" + a + "\",\"sig\":\"O576_zzndF29qmqcm5jrRZgKhpXtem-hmw7IQPyEEaL4-DG0nR0wIotGJY_rAKg7c6dxYryLPqFfi8gDud6-Bw\"}";
        String linkB = "{\"pub\":\"" + b + "\",\"sig\":\"i5ka_Tv1qlsFzO1H8awBRr1o0e7BNN-UaRNst_2pmNZOuHmiSDfsbecjHzrRgYExfT9WNGrEyEbsL5aIwYLdBw\"}";
        String chainB = chain(root, linkA, linkB);

        // the keys and codes of the vector
        equal(rootFp, Crypto.fingerprint(Crypto.ed25519Public(fill(1))));
        equal(root, Crypto.b64url(Crypto.ed25519Public(fill(1))));
        equal(aFp, Crypto.fingerprint(Crypto.fromB64url(a)));
        equal(bFp, Crypto.fingerprint(Crypto.fromB64url(b)));
        equal(fFp, Crypto.fingerprint(Crypto.ed25519Public(fill(4))));
        equal("133687038", Crypto.remoteId(rootFp));
        equal("878149855", Crypto.remoteId(aFp));
        equal("830526398", Crypto.remoteId(bFp));
        // deterministic signature: the phone signs the same bytes the PC does
        equal("O576_zzndF29qmqcm5jrRZgKhpXtem-hmw7IQPyEEaL4-DG0nR0wIotGJY_rAKg7c6dxYryLPqFfi8gDud6-Bw",
                Crypto.b64url(Crypto.sign(fill(1), Crypto.utf8("wf-code-v1|" + aFp))));

        check(CodeChain.belongs("133687038", bFp, chainB), "B answers for the code through root -> A -> B");
        check(!CodeChain.belongs("133687038", aFp, chainB), "B's chain does not end at A");
        check(CodeChain.belongs("133687038", aFp, chain(root, linkA)), "A answers with its own one-link chain");
        check(CodeChain.belongs("133687038", rootFp, chain(root)), "the root with links []");
        check(CodeChain.belongs("133687038", rootFp, null), "the root by its own ID");
        check(CodeChain.belongs("830526398", bFp, null), "B by its own ID (old path)");
        check(!CodeChain.belongs("133687038", bFp, null), "B without a chain is not the code");
        check(!CodeChain.belongs("133687038", fFp, chainB), "a foreign key with B's chain");
        String forged = "{\"pub\":\"" + b + "\",\"sig\":\"fvGsSmZZ0n86BCd12uJDXZkxa6DI2ka986_T9W1vONh5nsWS8zF24AX1SpS2C_cBk1RRCv0eYgZzQGFz78MmDw\"}";
        check(!CodeChain.belongs("133687038", bFp, chain(root, forged)), "B signed by F, not by the root");
        String[] nine = new String[9];
        Arrays.fill(nine, linkA);
        check(!CodeChain.belongs("133687038", aFp, chain(root, nine)), "more than 8 links");
        check(!CodeChain.belongs("133687039", bFp, chainB), "the code does not match the root");
        check(!CodeChain.belongs("133687038", bFp, "[1,2]"), "a chain that is not an object");
        check(!CodeChain.belongs("133687038", bFp, "{\"root\":\"!!\",\"links\":[]}"), "bad base64");
        check(!CodeChain.belongs("133687038", bFp, "not json"), "not JSON");
        check(CodeChain.belongs("133687038", bFp.toUpperCase(java.util.Locale.ROOT), chainB), "fingerprint case does not matter");
        check(CodeChain.belongs("133687038", bFp, chainB.replace("{\"root\"", "{\"x\":1,\"root\"")), "extra fields are ignored");
        System.out.println(assertions + " person code (chain) assertions passed.");
    }

    private static String chain(String root, String... links) {
        return "{\"root\":\"" + root + "\",\"links\":[" + String.join(",", links) + "]}";
    }

    private static byte[] fill(int value) {
        byte[] out = new byte[32];
        Arrays.fill(out, (byte) value);
        return out;
    }

    private static void equal(String expected, String actual) {
        assertions++;
        if (!expected.equals(actual)) throw new AssertionError("expected " + expected + " but got " + actual);
    }

    private static void check(boolean condition, String what) {
        assertions++;
        if (!condition) throw new AssertionError(what);
    }
}
