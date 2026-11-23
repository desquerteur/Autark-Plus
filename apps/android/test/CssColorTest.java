// Owns: executable checks of the bar colour strings the page sends (B-084 SystemBars) and the light/dark icon choice.
// Never: claims how Android draws the bars.
package com.teydralab.autark.android;

public final class CssColorTest {
    private static int assertions;

    public static void main(String[] args) {
        int fallback = 0xFF123456;
        equal(0xFFF3F3F3, CssColor.parse("rgb(243, 243, 243)", fallback));
        equal(0xFF202020, CssColor.parse(" RGB(32,32,32) ", fallback));
        equal(0xFFF5F5F5, CssColor.parse("rgba(245, 245, 245, 1)", fallback));
        equal(0xFF232323, CssColor.parse("rgb(35 35 35 / 0.9)", fallback));
        equal(0xFFF3F3F3, CssColor.parse("#f3f3f3", fallback));
        equal(0xFFFFFFFF, CssColor.parse("#fff", fallback));
        equal(0xFFFF0000, CssColor.parse("rgb(300, -4, 0)", fallback));
        for (String bad : new String[] { null, "", "transparent", "rgba(0, 0, 0, 0)", "rgb(0 0 0 / 0%)", "rgb(1,2)", "rgb(a,b,c)", "#12345", "red", "rgb(50%,0,0)" })
            equal(fallback, CssColor.parse(bad, fallback));
        check(CssColor.light(0xFFF3F3F3));
        check(CssColor.light(0xFFF5F5F5));
        check(!CssColor.light(0xFF202020));
        check(!CssColor.light(0xFF232323));
        check(!CssColor.light(0xFF2C665A));
        System.out.println(assertions + " bar colour assertions passed.");
    }

    private static void equal(int expected, int actual) {
        assertions++;
        if (expected != actual) throw new AssertionError(String.format("expected %08x but got %08x", expected, actual));
    }

    private static void check(boolean condition) {
        assertions++;
        if (!condition) throw new AssertionError("check failed");
    }
}
