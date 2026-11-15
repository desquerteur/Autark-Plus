// Owns: whether what an input field reports as its text is only its placeholder ("Message", "\u200bAsk Meta AI or
// Search") – some apps (WhatsApp) report an empty field's placeholder as text without isShowingHintText(), and phone
// use's type would then write the placeholder in front of the words. Never: Android calls (UseService asks the field).
package com.teydralab.autark.android.phoneuse;

final class TypedText {
    private TypedText() {}

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
