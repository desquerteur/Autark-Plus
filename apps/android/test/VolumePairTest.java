// Owns: executable checks of the phone's quick way into feedback (VolumePair, owner 16.11.2026 F15): volume up and down
// pressed together within 400 ms is the feedback cell's press – down when the pair goes down, up when the first key is
// let go, every key of it swallowed; one key alone stays the volume (once per tap, once per repeat while held, after
// the wait or its release); keys this detector never took pass; losing the keyboard lets a held pair go.
// Never: claims how Android delivers keys or how the volume panel looks (a phone checks that).
package com.teydralab.autark.android;

public final class VolumePairTest {
    private static int assertions;
    private static final int UP = VolumePair.UP, DOWN = VolumePair.DOWN;

    public static void main(String[] args) {
        tapIsTheVolumeOnce();
        heldKeyRepeatsTheVolume();
        bothTogetherAreTheFeedbackPress();
        theOrderDoesNotMatter();
        tooFarApartIsTheVolume();
        overdueWithoutTheTimer();
        oneAfterTheOtherIsTwoTaps();
        straysPass();
        focusLostLetsThePairGo();
        System.out.println(assertions + " volume pair assertions passed.");
    }

    private static void tapIsTheVolumeOnce() {
        VolumePair pair = new VolumePair();
        VolumePair.Step down = pair.key(UP, true, 0, 1000);
        step(down, true, 0, 0, VolumePair.WINDOW_MS, "the first key waits for the other");
        step(pair.key(UP, false, 0, 1120), true, UP, 0, 0, "let go alone: the volume up once");
        step(pair.expired(1400), false, 0, 0, 0, "the wait's end after the tap changes nothing");
        VolumePair.Step lower = pair.key(DOWN, true, 0, 2000);
        step(lower, true, 0, 0, VolumePair.WINDOW_MS, "the next key waits again");
        step(pair.key(DOWN, false, 0, 2090), true, DOWN, 0, 0, "volume down once");
    }

    private static void heldKeyRepeatsTheVolume() {
        VolumePair pair = new VolumePair();
        pair.key(DOWN, true, 0, 0);
        step(pair.expired(400), true, DOWN, 0, 0, "after 400 ms alone: the volume down");
        step(pair.key(DOWN, true, 1, 500), true, DOWN, 0, 0, "each repeat once more");
        step(pair.key(DOWN, true, 2, 550), true, DOWN, 0, 0, "and again");
        step(pair.key(UP, true, 0, 600), false, 0, 0, 0, "the other key now is its own press (Android's)");
        step(pair.key(UP, false, 0, 650), false, 0, 0, 0, "its release too");
        step(pair.key(DOWN, false, 0, 700), true, 0, 0, 0, "the held key's release ends it");
        step(pair.key(UP, true, 0, 900), true, 0, 0, VolumePair.WINDOW_MS, "back to waiting for a pair");
    }

    private static void bothTogetherAreTheFeedbackPress() {
        VolumePair pair = new VolumePair();
        pair.key(UP, true, 0, 0);
        step(pair.key(DOWN, true, 0, 150), true, 0, 1, 0, "the second key within the window: the feedback press goes down");
        step(pair.expired(400), false, 0, 0, 0, "no volume after the pair");
        step(pair.key(UP, true, 1, 600), true, 0, 0, 0, "repeats of either key are swallowed");
        step(pair.key(DOWN, true, 1, 610), true, 0, 0, 0, "both");
        step(pair.key(DOWN, false, 0, 1500), true, 0, -1, 0, "the first key let go: the press is let go (held = talk)");
        step(pair.key(UP, false, 0, 1550), true, 0, 0, 0, "the second release is swallowed, nothing more");
        step(pair.key(UP, true, 0, 3000), true, 0, 0, VolumePair.WINDOW_MS, "idle again: a new press waits");
        step(pair.key(UP, false, 0, 3050), true, UP, 0, 0, "and a tap is the volume");
        VolumePair edge = new VolumePair();
        edge.key(DOWN, true, 0, 0);
        step(edge.key(UP, true, 0, 399), true, 0, 1, 0, "399 ms apart is still together");
    }

    private static void theOrderDoesNotMatter() {
        VolumePair pair = new VolumePair();
        pair.key(DOWN, true, 0, 50);
        step(pair.key(UP, true, 0, 60), true, 0, 1, 0, "down first, then up: the same press");
        step(pair.key(UP, false, 0, 200), true, 0, -1, 0, "a short press: down and up, the page opens the feedback");
        step(pair.key(DOWN, false, 0, 210), true, 0, 0, 0, "the rest swallowed");
    }

    private static void tooFarApartIsTheVolume() {
        VolumePair pair = new VolumePair();
        pair.key(UP, true, 0, 0);
        step(pair.expired(400), true, UP, 0, 0, "the wait ran out: volume up");
        step(pair.key(DOWN, true, 0, 450), false, 0, 0, 0, "the other key after the window is the volume, as Android does it");
        step(pair.key(DOWN, false, 0, 500), false, 0, 0, 0, "its release passes");
        step(pair.key(UP, false, 0, 520), true, 0, 0, 0, "the first key's release ends it");
    }

    private static void overdueWithoutTheTimer() {
        VolumePair pair = new VolumePair();
        pair.key(UP, true, 0, 0);
        step(pair.key(DOWN, true, 0, 401), false, UP, 0, 0, "the timer had not run: the first key's volume now, the other passes");
        step(pair.expired(402), false, 0, 0, 0, "the late timer changes nothing");
        VolumePair late = new VolumePair();
        late.key(DOWN, true, 0, 0);
        step(late.key(DOWN, false, 0, 450), true, DOWN, 0, 0, "a long single tap without a repeat: one volume step");
    }

    private static void oneAfterTheOtherIsTwoTaps() {
        VolumePair pair = new VolumePair();
        pair.key(DOWN, true, 0, 0);
        step(pair.key(DOWN, false, 0, 80), true, DOWN, 0, 0, "the first tap: volume down");
        pair.key(UP, true, 0, 150);
        step(pair.key(UP, false, 0, 230), true, UP, 0, 0, "the second tap within 400 ms but after the release: volume up, no feedback");
    }

    private static void straysPass() {
        VolumePair pair = new VolumePair();
        step(pair.key(UP, false, 0, 10), false, 0, 0, 0, "a release whose press this app never had");
        step(pair.key(DOWN, true, 3, 20), false, 0, 0, 0, "a repeat of a key held before the app had the keyboard");
        pair.key(UP, true, 0, 100);
        step(pair.key(DOWN, false, 0, 120), false, 0, 0, 0, "the other key's stray release while waiting");
    }

    private static void focusLostLetsThePairGo() {
        VolumePair pair = new VolumePair();
        pair.key(UP, true, 0, 0);
        pair.key(DOWN, true, 0, 100);
        step(pair.reset(), false, 0, -1, 0, "the held pair is let go when the app loses the keyboard");
        step(pair.reset(), false, 0, 0, 0, "only once");
        step(pair.key(UP, false, 0, 900), false, 0, 0, 0, "the late release passes");
        VolumePair waiting = new VolumePair();
        waiting.key(DOWN, true, 0, 0);
        step(waiting.reset(), false, 0, 0, 0, "a waiting key is dropped quietly");
        step(waiting.expired(400), false, 0, 0, 0, "and its timer finds nothing");
    }

    private static void step(VolumePair.Step step, boolean consumed, int volume, int feedback, long waitMs, String what) {
        assertions++;
        if (step.consumed != consumed || step.volume != volume || step.feedback != feedback || step.waitMs != waitMs) {
            throw new AssertionError(what + String.format(": expected consumed=%s volume=%d feedback=%d wait=%d, got consumed=%s volume=%d feedback=%d wait=%d",
                    consumed, volume, feedback, waitMs, step.consumed, step.volume, step.feedback, step.waitMs));
        }
    }
}
