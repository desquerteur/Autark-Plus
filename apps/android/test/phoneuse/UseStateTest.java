// Owns: host checks of who has the phone (UseState, owner 10.11.2026 16:18): touch → paused → Continue → the same job
// goes on; Pause → Continue; ✕ → no further step of that job (waiting ones too), a new job may use the phone; the AI's
// own gestures never count as the person's touch. Never: a device test (the bubble and Android's touch events are
// checked on a phone).
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
        pauseNeverLiftsItself();
        System.out.println("UseStateTest: " + assertions + " assertions passed");
    }

    private static void touchPausesThenContinue() {
        UseState s = new UseState();
        check(code(s.step("run_a", 1_000)).equals("run"), "a first step runs");
        check(s.touched(2_000), "the person's touch pauses");
        check(s.mode() == UseState.Mode.PAUSED && s.byTouch(), "paused by touch");
        UseState.Refusal r = s.step("run_a", 3_000);
        check(code(r).equals("paused"), "a step while paused does not run");
        check(r.message.contains("Continue") && r.message.contains("Do not end the task"), "the AI is told the job stays");
        check(!s.acting(), "nothing acts while paused");
        check(!s.touched(3_500), "more touches change nothing while paused");
        check(s.resume(), "Continue");
        check(code(s.step("run_a", 4_000)).equals("run"), "the same job goes on after Continue");
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
        check(t.gestureCancelled(), "Android cancelling the AI's stroke (a real finger) pauses");
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
        check(code(r).equals("paused") && r.message.contains("use the phone themselves"), "the AI is told why");
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

    private static void pauseNeverLiftsItself() {
        UseState s = new UseState();
        s.step("run_i", 0);
        s.touched(1_000);
        check(code(s.step("run_i", UseState.SESSION_MS * 100)).equals("paused"), "a pause stays until Continue, however long");
        check(code(s.step("run_other", UseState.SESSION_MS * 100)).equals("paused"), "also for another job: the person has the phone");
    }
}
