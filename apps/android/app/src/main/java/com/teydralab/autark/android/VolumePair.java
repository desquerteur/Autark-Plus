// Owns: the phone's quick way into feedback (owner 16.11.2026, F15: "wenn man in der App ist, … so eine
// Tastenkombination … Wenn man die drückt, kann man direkt Feedback reinsprechen"): volume up and volume down pressed
// together – the second key down while the first is held, within WINDOW_MS of it – is the feedback cell's press:
// `feedback` +1 when the pair goes down, -1 when the first of the two is let go (MainActivity tells the page
// {t:'feedback', down}; short opens the feedback, held talks, as on the cell). One key alone stays the volume: its press
// waits WINDOW_MS – or its release, whichever is first – for the other key, then changes the volume once (`volume`), and
// once more for each repeat while it is held. Pure Java on the events' times (tested on the host, test/VolumePairTest).
// Never: Android, timers or the volume itself – the activity applies each Step and calls expired() after `waitMs`.
package com.teydralab.autark.android;

final class VolumePair {
    /** How close together the two keys go down to count as one press. */
    static final long WINDOW_MS = 400;
    static final int UP = 1, DOWN = -1;

    /** What the activity does for one event: swallow it (else Android handles it), change the volume (+1 up, -1 down),
     *  tell the page (+1 the pair went down, -1 it was let go), and call expired() after `waitMs` (0: no call). */
    static final class Step {
        final boolean consumed;
        final int volume;
        final int feedback;
        final long waitMs;

        Step(boolean consumed, int volume, int feedback, long waitMs) {
            this.consumed = consumed;
            this.volume = volume;
            this.feedback = feedback;
            this.waitMs = waitMs;
        }
    }

    static final Step PASS = new Step(false, 0, 0, 0);
    private static final Step SWALLOW = new Step(true, 0, 0, 0);
    private static final int IDLE = 0, WAITING = 1, SINGLE = 2, PAIRED = 3;

    private int state = IDLE;
    /** The key that went down first (UP or DOWN), and when. */
    private int first;
    private long since;
    /** PAIRED: the page holds a press whose release is still owed. */
    private boolean pressing;
    /** The keys this detector took that are still down (bit 1: UP, bit 2: DOWN). */
    private int held;

    /** One volume key event: `key` UP or DOWN, going down (`repeat`: its auto-repeat count) or up, at `now` (ms). */
    Step key(int key, boolean down, int repeat, long now) {
        Step overdue = state == WAITING && now - since >= WINDOW_MS ? single() : null;
        Step step = event(key, down, repeat, now);
        return overdue == null ? step : new Step(step.consumed, overdue.volume + step.volume, step.feedback, step.waitMs);
    }

    /** WINDOW_MS after a first key went down: alone, it is the volume (nothing when the wait already ended). */
    Step expired(long now) {
        return state == WAITING && now - since >= WINDOW_MS ? single() : PASS;
    }

    /** The app lost the keyboard (another window, the background): everything ends; a held pair is let go. */
    Step reset() {
        boolean owed = state == PAIRED && pressing;
        state = IDLE;
        pressing = false;
        held = 0;
        return owed ? new Step(false, 0, -1, 0) : PASS;
    }

    private Step event(int key, boolean down, int repeat, long now) {
        int bit = key == UP ? 1 : 2;
        switch (state) {
            case IDLE:
                if (!down || repeat > 0) return PASS; // a key that went down before this app had it
                state = WAITING;
                first = key;
                since = now;
                held |= bit;
                return new Step(true, 0, 0, WINDOW_MS);
            case WAITING:
                if (key != first) {
                    if (!down) return PASS;
                    state = PAIRED;
                    pressing = true;
                    held |= bit;
                    return new Step(true, 0, 1, 0);
                }
                if (down) return SWALLOW; // an early repeat while it waits
                held &= ~bit;
                state = IDLE;
                return new Step(true, key, 0, 0); // a tap: the volume once
            case SINGLE:
                if (key != first) return PASS; // the other key on its own, as Android does it
                if (down) return new Step(true, key, 0, 0);
                held &= ~bit;
                state = IDLE;
                return SWALLOW;
            default: // PAIRED
                if (down) { held |= bit; return SWALLOW; }
                if ((held & bit) == 0) return PASS;
                held &= ~bit;
                int feedback = pressing ? -1 : 0;
                pressing = false;
                if (held == 0) state = IDLE;
                return new Step(true, 0, feedback, 0);
        }
    }

    private Step single() {
        state = SINGLE;
        return new Step(true, first, 0, 0);
    }
}
