// Owns: reading the colour strings the page sends for the system bars (computed style: rgb()/rgba(), or #rgb/#rrggbb)
// and whether a colour is light enough for dark bar icons. Never: depends on Android (host tests run it).
package com.teydralab.autark.android;

import java.util.Locale;

final class CssColor {
    private CssColor() {}

    /** An opaque ARGB int, or the fallback for anything else (transparent, unknown words, garbage). */
    static int parse(String css, int fallback) {
        if (css == null) return fallback;
        String value = css.trim().toLowerCase(Locale.ROOT);
        try {
            if (value.matches("#[0-9a-f]{6}")) return 0xFF000000 | Integer.parseInt(value.substring(1), 16);
            if (value.matches("#[0-9a-f]{3}")) {
                int r = Character.digit(value.charAt(1), 16), g = Character.digit(value.charAt(2), 16), b = Character.digit(value.charAt(3), 16);
                return 0xFF000000 | (r * 17 << 16) | (g * 17 << 8) | (b * 17);
            }
            if (value.matches("rgba?\\(.*\\)")) {
                String[] parts = value.substring(value.indexOf('(') + 1, value.length() - 1).trim().split("[\\s,/]+");
                if (parts.length < 3) return fallback;
                if (parts.length > 3 && Double.parseDouble(parts[3].replace("%", "")) == 0) return fallback;
                return 0xFF000000 | (channel(parts[0]) << 16) | (channel(parts[1]) << 8) | channel(parts[2]);
            }
        } catch (NumberFormatException error) { return fallback; }
        return fallback;
    }

    /** True when dark icons read better on this colour (relative luminance above the middle). */
    static boolean light(int color) {
        double r = linear((color >> 16) & 0xFF), g = linear((color >> 8) & 0xFF), b = linear(color & 0xFF);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179;
    }

    private static int channel(String part) {
        double value = Double.parseDouble(part);
        return (int) Math.max(0, Math.min(255, Math.round(value)));
    }

    private static double linear(int channel) {
        double c = channel / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
}
