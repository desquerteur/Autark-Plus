// Owns: whether what an input field reports as its text is only its placeholder ("Message", "\u200bAsk Meta AI or
// Search") – some apps (WhatsApp) report an empty field's placeholder as text without isShowingHintText(), and phone
// use's type would then write the placeholder in front of the words – and what a type step tells the PC the field
// reads afterwards (chat sweep 16.11.2026: words beside the typed text show at once). Never: Android calls (UseService
// asks the field), or a password's text.
package com.teydralab.autark.android.phoneuse;

final class TypedText {
    private TypedText() {}

    /** The most of a field's text a type step sends back (the PC cuts to the same). */
    static final int READBACK_MAX = 300;

    /** What the field reads after typing, for the PC: null for a password field, "" while it shows its hint. */
    static String readback(CharSequence text, boolean password, boolean showingHint) {
        if (password) return null;
        if (showingHint || text == null) return "";
        String all = text.toString();
        return all.length() > READBACK_MAX ? all.substring(0, READBACK_MAX) : all;
    }

    /** True when the field's text is nothing but its known placeholder (or only invisible characters). */
    static boolean placeholder(CharSequence text, CharSequence hint) {
        String shown = plain(text);
        if (shown.isEmpty()) return true;
        return hint != null && !plain(hint).isEmpty() && shown.equals(plain(hint));
    }

    /** The same visible words – zero-width characters and outer spaces left out. */
    static boolean same(CharSequence a, CharSequence b) {
        return plain(a).equals(plain(b));
    }

    static String plain(CharSequence text) {
        if (text == null) return "";
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == 0x200B || c == 0x200C || c == 0x200D || c == 0x2060 || c == 0xFEFF) continue;
            out.append(c);
        }
        return out.toString().trim();
    }
}
