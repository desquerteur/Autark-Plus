// Owns: which text field phone.type may write into (Konrad 12.11.2026 21:27, after the Samsung WhatsApp case): the field
// the AI last looked at (focused at its phone.ui_tree or phone.screenshot) or tapped, in the app it last looked at, within
// the same PC job. Anything else – another app came to the front, the focus moved to another field, nothing looked at yet
// in this job – is a conflict before the first character, so words never land somewhere the AI did not see.
// "Some field has the focus" is not enough. Never: a guess from field contents or a device check (that is the phone test).
package com.teydralab.autark.android.phoneuse;

import java.util.Objects;

final class TypeTarget {
    /** A text field as seen on screen: Android's node snapshot as its identity (null when unknown), its app, view id,
     *  class and bounds (left, top, right, bottom). The identity is compared with equals() only – AccessibilityNodeInfo's
     *  equals compares the full source node id and window id; its 32-bit hashCode folds them and may collide. */
    static final class Field {
        final Object key;
        final String pkg;
        final String id;
        final String cls;
        final int left, top, right, bottom;

        Field(Object key, String pkg, String id, String cls, int left, int top, int right, int bottom) {
            this.key = key;
            this.pkg = pkg == null ? "" : pkg;
            this.id = id == null ? "" : id;
            this.cls = cls == null ? "" : cls;
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }

        static Field of(Object key, ScreenTree.Node node) {
            if (node == null) return null;
            int[] b = node.bounds();
            return new Field(key, str(node.pkg()), node.id(), str(node.cls()), b[0], b[1], b[2], b[3]);
        }

        /** The same field. With Android's view identity on both sides that identity decides – it stays when the keyboard
         *  pushes the field up and differs for a look-alike field below it. Without it only an exact match counts (app,
         *  view id, class and all four bounds): a moved or look-alike field is not provably the same one, so it is not. */
        boolean same(Field other) {
            if (other == null || !pkg.equals(other.pkg) || !cls.equals(other.cls) || !id.equals(other.id)) return false;
            if (key != null && other.key != null) return key.equals(other.key);
            return left == other.left && top == other.top && right == other.right && bottom == other.bottom;
        }
    }

    private String job;
    private String pkg;
    /** The one field typing may go into: the latest look's focused field or the latest tap's field, whichever came last. */
    private Field aim;

    /** phone.ui_tree or phone.screenshot of `job` saw app `pkgNow` with `focused` (null: no text field) having the focus. */
    synchronized void looked(String job, String pkgNow, Field focused) {
        this.job = job;
        this.pkg = pkgNow;
        this.aim = focused;
    }

    /** phone.tap of `job` in app `pkgNow` hit `field` (null: no text field under the finger). The newer tap replaces any
     *  earlier aim: after a tap beside every field, typing needs a new look that shows where the focus went. */
    synchronized void tapped(String job, String pkgNow, Field field) {
        this.job = job;
        this.pkg = pkgNow;
        this.aim = field;
    }

    /** null when `job` may type into `current` (the focused field, null: none) in app `pkgNow`; else the conflict message. */
    synchronized String refuse(String job, String pkgNow, Field current) {
        if (pkg == null || !Objects.equals(job, this.job)) {
            return "I have not looked at this screen in this task yet: phone.ui_tree first, then tap the field.";
        }
        if (!Objects.equals(pkgNow, pkg)) {
            return "Another app came to the front since my last look (" + pkg + " → " + pkgNow + "). Nothing was typed: phone.ui_tree, then tap the field again.";
        }
        if (current == null) return "No text field has the focus: I tap the field first.";
        if (aim == null) return "My last look or tap showed no text field, so I do not know where the words would go. Nothing was typed: phone.ui_tree, then tap the field.";
        if (current.same(aim)) return null;
        return "The focus is on another field than the one I looked at or tapped. Nothing was typed: phone.ui_tree, then tap the right field.";
    }

    private static String str(CharSequence value) { return value == null ? "" : value.toString(); }
}
