// Owns: host checks that phone use's type treats an app-reported placeholder as an empty field (WhatsApp's
// "Message" and "\u200bAsk Meta AI or Search", 10.11.2026) and keeps real text. Never: a device test.
package com.teydralab.autark.android.phoneuse;

public final class TypedTextTest {
    private static int assertions;

    private static void check(boolean ok, String what) {
        assertions++;
        if (!ok) throw new AssertionError(what);
    }

    public static void main(String[] args) {
        check(TypedText.placeholder("Message", "Message"), "WhatsApp entry: text equals its hint");
        check(TypedText.placeholder("\u200bAsk Meta AI or Search", "Ask Meta AI or Search"), "WhatsApp search: zero-width in front");
        check(TypedText.placeholder("\u200b", null), "only a zero-width character");
        check(TypedText.placeholder("  ", null), "only spaces");
        check(TypedText.placeholder(null, null), "no text");
        check(!TypedText.placeholder("Hallo", "Message"), "real words stay");
        check(!TypedText.placeholder("Message", null), "without a hint the words are not judged here");
        check(!TypedText.placeholder("MessageHallo", "Message"), "placeholder plus words is real text");
        check(!TypedText.placeholder("Message", ""), "an empty hint matches nothing");
        check(TypedText.same("\u200bAsk Meta AI or Search", "Ask Meta AI or Search "), "same visible words");
        check(!TypedText.same("Message", "Hallo"), "different words");
        check(TypedText.plain("a\u200b\u200c\u200d\u2060\ufeffb").equals("ab"), "all zero-width kinds left out");
        System.out.println("TypedTextTest: " + assertions + " assertions passed");
    }
}
