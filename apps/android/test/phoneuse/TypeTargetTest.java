// Owns: host checks that phone.type only writes into the field the AI last looked at or tapped (Konrad 12.11.2026
// 21:27/21:31): the normal look → tap → type path still types; another app, another field, no look in this job, a
// look-alike field below the target, or an older target after a newer tap is a conflict before the first character –
// including the regression where app or field changed after the look but before typing. Never: a device test (focus,
// windows and Android's node identity are checked on a phone).
package com.teydralab.autark.android.phoneuse;

public final class TypeTargetTest {
    private static int assertions;

    private static void check(boolean ok, String what) {
        assertions++;
        if (!ok) throw new AssertionError(what);
    }

    /** Stand-in for AccessibilityNodeInfo's identity: equals compares the full ids, hashCode folds them (may collide). */
    private static final class Node {
        final int window; final long source;
        Node(int window, long source) { this.window = window; this.source = source; }
        @Override public boolean equals(Object o) { return o instanceof Node && ((Node) o).window == window && ((Node) o).source == source; }
        @Override public int hashCode() { return 1; }
    }

    private static Node node(int window, long source) { return new Node(window, source); }

    private static final String WA = "com.whatsapp";
    private static final String EDIT = "android.widget.EditText";
    private static final TypeTarget.Field MESSAGE = new TypeTarget.Field(node(7, 101), WA, "com.whatsapp:id/entry", EDIT, 40, 2000, 900, 2100);
    private static final TypeTarget.Field MESSAGE_KEYBOARD = new TypeTarget.Field(node(7, 101), WA, "com.whatsapp:id/entry", EDIT, 40, 1200, 900, 1300);
    private static final TypeTarget.Field SEARCH = new TypeTarget.Field(node(7, 55), WA, "com.whatsapp:id/search_src_text", EDIT, 40, 100, 900, 200);
    private static final TypeTarget.Field CHROME_URL = new TypeTarget.Field(node(9, 12), "com.android.chrome", "com.android.chrome:id/url_bar", EDIT, 40, 100, 900, 200);

    public static void main(String[] args) {
        lookTapType();
        lookedFocusedField();
        noLookInThisJob();
        appChangedBeforeTyping();
        fieldChangedBeforeTyping();
        newerTapReplacesOlderTarget();
        tapBesideFieldsNeedsNewLook();
        lookAlikeFieldBelowWithIdentity();
        sameHashOtherNode();
        lookAlikeFieldBelowWithoutIdentity();
        sameIdOtherColumn();
        noFocusedField();
        System.out.println("TypeTargetTest: " + assertions + " assertions passed");
    }

    private static void lookTapType() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, MESSAGE);
        check(t.refuse("run_a", WA, MESSAGE) == null, "the tapped field may be typed into");
        check(t.refuse("run_a", WA, MESSAGE_KEYBOARD) == null, "the same view pushed up by the keyboard is the same field");
        check(t.refuse("run_a", WA, MESSAGE) == null, "a second type into the same field still runs");
    }

    private static void lookedFocusedField() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, SEARCH);
        check(t.refuse("run_a", WA, SEARCH) == null, "the field that had the focus at the look may be typed into");
    }

    private static void noLookInThisJob() {
        TypeTarget t = new TypeTarget();
        check(t.refuse("run_a", WA, MESSAGE) != null, "nothing looked at yet: conflict");
        t.looked("run_a", WA, MESSAGE);
        String r = t.refuse("run_b", WA, MESSAGE);
        check(r != null && r.contains("phone.ui_tree"), "another job's look does not count");
    }

    private static void appChangedBeforeTyping() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, MESSAGE);
        String r = t.refuse("run_a", "com.android.chrome", CHROME_URL);
        check(r != null && r.contains("Another app") && r.contains("Nothing was typed"), "another app in front before typing: conflict");
    }

    private static void fieldChangedBeforeTyping() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, MESSAGE);
        String r = t.refuse("run_a", WA, SEARCH);
        check(r != null && r.contains("another field"), "the focus jumped to another field before typing: conflict");
    }

    private static void newerTapReplacesOlderTarget() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, SEARCH);
        t.tapped("run_a", WA, MESSAGE);
        check(t.refuse("run_a", WA, SEARCH) != null, "after a look at A and a tap on B, A is no longer a target");
        check(t.refuse("run_a", WA, MESSAGE) == null, "B, the newer tap, is the target");
    }

    private static void tapBesideFieldsNeedsNewLook() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, SEARCH);
        t.tapped("run_a", WA, null);
        String r = t.refuse("run_a", WA, SEARCH);
        check(r != null && r.contains("no text field"), "a tap beside every field replaces the looked field too");
        t.looked("run_a", WA, SEARCH);
        check(t.refuse("run_a", WA, SEARCH) == null, "a new look that shows the focus makes it typable again");
    }

    private static void lookAlikeFieldBelowWithIdentity() {
        TypeTarget.Field upper = new TypeTarget.Field(node(7, 201), WA, "app:id/line", EDIT, 40, 300, 900, 380);
        TypeTarget.Field lower = new TypeTarget.Field(node(7, 202), WA, "app:id/line", EDIT, 40, 500, 900, 580);
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, upper);
        check(t.refuse("run_a", WA, lower) != null, "a look-alike field below (same id, class, width, height) is another view: conflict");
    }

    private static void sameHashOtherNode() {
        TypeTarget.Field a = new TypeTarget.Field(node(7, 0x1_0000_0001L), WA, "app:id/line", EDIT, 40, 300, 900, 380);
        TypeTarget.Field b = new TypeTarget.Field(node(7, 0x2_0000_0001L), WA, "app:id/line", EDIT, 40, 300, 900, 380);
        TypeTarget.Field aMoved = new TypeTarget.Field(node(7, 0x1_0000_0001L), WA, "app:id/line", EDIT, 40, 900, 900, 980);
        check(a.key.hashCode() == b.key.hashCode(), "the two nodes really share a hash");
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, a);
        check(t.refuse("run_a", WA, b) != null, "another node with the same hash (and the same bounds) is another field: conflict");
        check(t.refuse("run_a", WA, aMoved) == null, "the same node moved by the keyboard stays typable");
    }

    private static void lookAlikeFieldBelowWithoutIdentity() {
        TypeTarget.Field upper = new TypeTarget.Field(null, WA, null, EDIT, 40, 300, 900, 380);
        TypeTarget.Field lower = new TypeTarget.Field(null, WA, null, EDIT, 40, 500, 900, 580);
        TypeTarget.Field same = new TypeTarget.Field(null, WA, null, EDIT, 40, 300, 900, 380);
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, upper);
        check(t.refuse("run_a", WA, lower) != null, "without a view identity a look-alike field below is not provably the same: conflict");
        check(t.refuse("run_a", WA, same) == null, "without a view identity only an exact match counts");
        TypeTarget.Field mixed = new TypeTarget.Field(node(7, 300), WA, null, EDIT, 40, 300, 900, 380);
        check(t.refuse("run_a", WA, mixed) == null, "identity on one side only falls back to the exact match");
    }

    private static void sameIdOtherColumn() {
        TypeTarget.Field left = new TypeTarget.Field(null, WA, "app:id/qty", EDIT, 40, 300, 300, 380);
        TypeTarget.Field right = new TypeTarget.Field(null, WA, "app:id/qty", EDIT, 500, 300, 760, 380);
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, left);
        check(t.refuse("run_a", WA, right) != null, "the same view id in another column is another field");
    }

    private static void noFocusedField() {
        TypeTarget t = new TypeTarget();
        t.looked("run_a", WA, null);
        t.tapped("run_a", WA, MESSAGE);
        String r = t.refuse("run_a", WA, null);
        check(r != null && r.contains("tap the field"), "no focused field: tap first");
    }
}
