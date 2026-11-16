// Owns: host checks of who has the phone (UseState, owner 10.11.2026 16:18, 15.11.2026 F16): touch → paused → it goes on
// by itself 5 s after the last touch (or at once on Continue); Pause → holds until Continue; ✕ → no further step of that
// job (waiting ones too), a new job may use the phone; the person's ✓ to the AI's question opens the job again; the AI's
// own gestures never count as the person's touch; the refusals the AI reads are facts with a next step, no "do not".
// Never: a device test (the bubble and Android's touch events are checked on a phone).
package com.teydralab.autark.android.phoneuse;

public final class UseStateTest {
    private static int assertions;

    private static void check(boolean ok, String what) {
        assertions++;
        if (!ok) throw new AssertionError(what);
    }

    private static String code(UseState.Refusal refusal) { return refusal == null ? "run" : refusal.code; }

    public static void main(String[] args) {
        touchPausesThenContinue();
        ownGesturesAreNotTouches();
        explicitPauseThenContinue();
        endStopsTheJobForGood();
        endWithoutJobIds();
        lateStepOfEndedJobAfterNewerJob();
        touchPauseLiftsItself();
        personPauseHolds();
        agreedOpensTheJob();
        refusalsAreFacts();
        System.out.println("UseStateTest: " + assertions + " assertions passed");
    }

    private static void touchPausesThenContinue() {
        UseState s = new UseState();
        check(code(s.step("run_a", 1_000)).equals("run"), "a first step runs");
        check(s.touched(2_000), "the person's touch pauses");
        check(s.mode() == UseState.Mode.PAUSED && s.byTouch(), "paused by touch");
        UseState.Refusal r = s.step("run_a", 3_000);
        check(code(r).equals("paused"), "a step while paused does not run");
        check(r.message.contains("5 s") && r.message.contains("phone.say"), "the AI reads when it goes on and how to ask");
        check(!s.acting(), "nothing acts while paused");
        check(s.touched(3_500), "a further touch starts the quiet wait again");
        check(s.resume(), "Continue");
        check(code(s.step("run_a", 4_000)).equals("run"), "the same job goes on after Continue, before the wait is over");
    }

    private static void touchPauseLiftsItself() {
        UseState s = new UseState();
        s.step("run_i", 0);
        check(s.touched(1_000), "a touch pauses");
        check(code(s.step("run_i", 1_000 + UseState.TOUCH_QUIET_MS - 100)).equals("paused"), "4.9 s after the last touch the step is refused");
        check(code(s.step("run_i", 1_000 + UseState.TOUCH_QUIET_MS)).equals("run"), "5 s after the last touch it runs by itself");
        check(s.mode() == UseState.Mode.ACTIVE, "and phone use is active again");
        UseState t = new UseState();
        t.step("run_j", 0);
        t.touched(1_000);
        check(t.touched(4_000), "a second touch while paused");
        check(code(t.step("run_j", 1_000 + UseState.TOUCH_QUIET_MS)).equals("paused"), "the second touch started the wait again");
        check(!t.quiet(4_000 + UseState.TOUCH_QUIET_MS - 1), "the bubble's wait is not over yet");
        check(t.quiet(4_000 + UseState.TOUCH_QUIET_MS) && t.acting(), "the bubble's wait over: active again by itself");
        check(!t.quiet(4_000 + UseState.TOUCH_QUIET_MS + 1), "quiet while active changes nothing");
        UseState g = new UseState();
        g.step("run_k", 0);
        check(g.gestureCancelled(2_000), "a finger in the AI's gesture is a touch");
        check(code(g.step("run_k", 2_000 + UseState.TOUCH_QUIET_MS)).equals("run"), "and it goes on 5 s later too");
        check(code(g.step("run_other", 3 * UseState.TOUCH_QUIET_MS)).equals("run"), "another job is not held by an old touch");
    }

    private static void personPauseHolds() {
        UseState s = new UseState();
        s.step("run_l", 0);
        check(s.pause(), "the person's Pause");
        check(!s.touched(1_000), "a touch while held by Pause changes nothing");
        check(!s.quiet(UseState.SESSION_MS * 100), "Pause is never lifted by the quiet wait");
        check(code(s.step("run_l", UseState.SESSION_MS * 100)).equals("paused"), "Pause holds however long");
        check(code(s.step("run_other", UseState.SESSION_MS * 100)).equals("paused"), "also for another job: the person has the phone");
        UseState t = new UseState();
        t.step("run_m", 0);
        t.touched(1_000);
        check(t.pause() && !t.byTouch(), "Pause during a touch-pause turns it into the person's hold");
        check(code(t.step("run_m", 1_000 + UseState.TOUCH_QUIET_MS * 10)).equals("paused"), "which the quiet wait does not lift");
        check(t.resume() && code(t.step("run_m", 1_000 + UseState.TOUCH_QUIET_MS * 11)).equals("run"), "Continue lifts it");
        UseState e = new UseState();
        e.step("run_n", 0);
        e.end();
        check(!e.pause() && !e.touched(1) && !e.quiet(UseState.TOUCH_QUIET_MS * 10), "ended stays ended: Pause, touch and the wait change nothing");
        check(code(e.step("run_n", UseState.TOUCH_QUIET_MS * 10)).equals("ended"), "its steps stay refused");
    }

    private static void agreedOpensTheJob() {
        UseState s = new UseState();
        s.step("run_o", 0);
        s.pause();
        s.agreed("run_o", 1_000);
        check(s.acting() && code(s.step("run_o", 1_001)).equals("run"), "✓ to the AI's question ends the person's Pause for that job");
        s.end();
        check(code(s.step("run_o", 2_000)).equals("ended"), "✕ ends the job");
        s.agreed("run_o", 3_000);
        check(code(s.step("run_o", 3_001)).equals("run"), "✓ after ✕ opens that job again");
        UseState old = new UseState();
        old.step(null, 0);
        old.end();
        check(code(old.step(null, 1_000)).equals("ended"), "an older PC without job ids: ended within the session");
        old.agreed(null, 2_000);
        check(code(old.step(null, 2_001)).equals("run"), "and ✓ opens it again");
    }

    private static void refusalsAreFacts() {
        UseState s = new UseState();
        s.step("run_q", 0);
        s.touched(1);
        String[] texts = { UseState.PAUSED_TOUCH, UseState.PAUSED_PERSON, UseState.ENDED, s.midStep().message };
        s.pause();
        String held = s.midStep().message;
        s.end();
        String cut = s.midStep().message;
        for (String text : new String[] { texts[0], texts[1], texts[2], texts[3], held, cut }) {
            String lower = text.toLowerCase(java.util.Locale.ROOT);
            check(!lower.contains("do not") && !lower.contains("don't") && !lower.contains("never"), "a fact, no prohibition: " + text);
            check(text.contains(" I ") || text.startsWith("I "), "in the AI's own voice: " + text);
        }
        check(UseState.PAUSED_TOUCH.contains((UseState.TOUCH_QUIET_MS / 1000) + " s") && texts[3].contains((UseState.TOUCH_QUIET_MS / 1000) + " s"), "the texts name the real wait");
    }

    private static void ownGesturesAreNotTouches() {
        UseState s = new UseState();
        s.step("run_b", 10_000);
        s.ownGesture(10_000, 300);
        check(!s.touched(10_200), "a touch event during the AI's own stroke is its own");
        check(!s.touched(10_000 + 300 + UseState.OWN_GRACE_MS), "still own within the grace");
        check(s.touched(10_000 + 300 + UseState.OWN_GRACE_MS + 1), "after the grace it is the person's");
        UseState t = new UseState();
        t.step("run_c", 0);
        check(t.gestureCancelled(0), "Android cancelling the AI's stroke (a real finger) pauses");
        UseState.Refusal mid = t.midStep();
        check(code(mid).equals("paused") && mid.message.contains("part-way"), "the step that was cut says so");
        UseState idle = new UseState();
        check(!idle.touched(5_000), "no session yet: the person's own phone use is not watched");
        idle.step("run_d", 0);
        check(!idle.touched(UseState.SESSION_MS + 1), "long after the last step a touch is not a pause");
    }

    private static void explicitPauseThenContinue() {
        UseState s = new UseState();
        s.step("run_e", 0);
        check(s.pause(), "the person's Pause");
        check(s.mode() == UseState.Mode.PAUSED && !s.byTouch(), "paused by the person");
        UseState.Refusal r = s.step("run_e", 1_000);
        check(code(r).equals("paused") && r.message.contains("Pause") && r.message.contains("Continue"), "the AI reads why and what lifts it");
        check(!s.pause(), "Pause twice changes nothing");
        check(s.resume(), "Continue");
        check(!s.resume(), "Continue while active changes nothing");
        check(code(s.step("run_e", 2_000)).equals("run"), "the job goes on");
    }

    private static void endStopsTheJobForGood() {
        UseState s = new UseState();
        s.step("run_f", 0);
        check(s.end(), "✕");
        check(!s.acting(), "the running step stops");
        check(code(s.midStep()).equals("ended"), "a cut step says ended");
        for (int i = 1; i <= 5; i++) check(code(s.step("run_f", i * 1_000)).equals("ended"), "every further step of that job is refused (" + i + ")");
        check(code(s.step("run_f", UseState.SESSION_MS * 10)).equals("ended"), "also much later: ✕ is for good for that job");
        check(!s.resume(), "Continue does not undo ✕");
        check(code(s.step("run_g", UseState.SESSION_MS * 10 + 1)).equals("run"), "a new job may use the phone");
        UseState p = new UseState();
        p.step("run_h", 0);
        p.pause();
        check(p.end(), "✕ while paused");
        check(code(p.step("run_h", 1_000)).equals("ended"), "ended, not paused");
    }

    private static void endWithoutJobIds() {
        UseState s = new UseState();
        s.step(null, 0);
        s.end();
        check(code(s.step(null, 60_000)).equals("ended"), "an older PC without job ids: refused within the session");
        check(code(s.step(null, 60_000 + UseState.SESSION_MS)).equals("ended"), "each refused try keeps the session");
        check(code(s.step(null, 60_000 + 2 * UseState.SESSION_MS + 1)).equals("run"), "after a quiet session a new job starts");
    }

    // Konrad's repro 10.11.2026 21:16: A, ✕, B, then a late step of A was let through.
    private static void lateStepOfEndedJobAfterNewerJob() {
        UseState s = new UseState();
        s.step("A", 0);
        s.end();
        check(code(s.step("A", 1)).equals("ended"), "A right after ✕ is refused");
        check(code(s.step("B", 2)).equals("run"), "a new job B may run");
        check(code(s.step("A", 3)).equals("ended"), "a late step of A stays refused after B");
        check(code(s.step("B", 4)).equals("run"), "B goes on");
        check(s.mode() == UseState.Mode.ACTIVE, "A's refusal does not touch B's state");
        s.end();
        check(code(s.step("B", 5)).equals("ended") && code(s.step("A", 6)).equals("ended"), "both ended jobs stay refused");
        check(code(s.step("C", 7)).equals("run"), "a third job may run");
        UseState many = new UseState();
        many.step("first", 0); many.end();
        for (int i = 0; i < UseState.ENDED_KEPT - 1; i++) { many.step("job" + i, i + 1); many.end(); }
        check(code(many.step("first", 1_000)).equals("ended"), "the oldest of ENDED_KEPT ended jobs is still refused");
    }

}
