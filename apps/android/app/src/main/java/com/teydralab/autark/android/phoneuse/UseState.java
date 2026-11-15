// Owns: who has the phone while the AI uses it (owner 10.11.2026 16:18) – three states, kept apart:
// active (the AI's steps run), paused (the person has the phone: their touch or their Pause; the AI's job stays and
// no step runs until the person taps Continue) and ended (the person's ✕: this job's steps are refused for good,
// waiting ones included). A touch of the person pauses at once; the AI's own gestures do not count as their touch.
// A job is the PC's run (the request's `job`); every job the person ended stays refused, also after a newer job ran
// (the last ENDED_KEPT of them). A PC without job ids (older desktop) gets one job per session, which ends SESSION_MS
// after the last step. Pure Java, no Android: UseService asks it before every step and tells it about
// touches and its own gestures; UseBubble shows it. Never: lets a step run while paused or ended, or turns a pause
// back into active by itself.
package com.teydralab.autark.android.phoneuse;

import java.util.LinkedHashSet;
import java.util.Set;

final class UseState {
    enum Mode { ACTIVE, PAUSED, ENDED }

    /** A refused step: `code` and the words the AI reads (phoneUse.reply's error). */
    static final class Refusal {
        final String code;
        final String message;
        Refusal(String code, String message) { this.code = code; this.message = message; }
    }

    /** Without a job id, a pause in steps this long starts a new job (ended no longer applies). */
    static final long SESSION_MS = 5 * 60_000;
    /** An own gesture's touch events can still arrive this long after its stroke ended. */
    static final long OWN_GRACE_MS = 400;
    /** How many ended jobs are remembered (a late step of an older one is still refused). */
    static final int ENDED_KEPT = 64;

    static final String PAUSED_TOUCH = "The person touched the phone, so phone use paused before this step (it did not run). "
            + "The task stays: they continue it with 'Continue' at the top of the screen. Do not end the task and do not tap "
            + "meanwhile – check again in a minute or two (steps answer 'paused' until then), or go on with other work.";
    static final String PAUSED_PERSON = "The person paused phone use to use the phone themselves; this step did not run. "
            + "The task stays: they continue it with 'Continue' at the top of the screen. Do not end the task – check again "
            + "in a minute or two (steps answer 'paused' until then), or go on with other work.";
    static final String ENDED = "The person ended phone use for this task with ✕; this step did not run. Do not use the "
            + "phone for this task again – tell them what is left, or finish it another way.";

    private Mode mode = Mode.ACTIVE;
    private boolean byTouch;
    private String job;
    private final Set<String> endedJobs = new LinkedHashSet<>();
    private boolean endedWithoutJob;
    private long lastStep = Long.MIN_VALUE / 2;
    private long ownUntil = Long.MIN_VALUE / 2;

    synchronized Mode mode() { return mode; }

    /** Paused by a touch (true) or by the person's Pause (false); meaningful only while paused. */
    synchronized boolean byTouch() { return byTouch; }

    /** Before each step: null lets it run; else why not. `job` may be null (a PC without job ids). */
    synchronized Refusal step(String job, long now) {
        String key = job != null && !job.isEmpty() ? job : null;
        boolean sameSession = now - lastStep <= SESSION_MS;
        if (key == null && !sameSession) endedWithoutJob = false; // a quiet session: an older PC's next job
        boolean ended = key != null ? endedJobs.contains(key) : endedWithoutJob;
        if (ended) { lastStep = now; return new Refusal("ended", ENDED); }
        if (mode == Mode.ENDED) mode = Mode.ACTIVE; // a new job: the ✕ was for the one before
        this.job = key;
        lastStep = now;
        if (mode == Mode.PAUSED) return new Refusal("paused", byTouch ? PAUSED_TOUCH : PAUSED_PERSON);
        return null;
    }

    /** The AI's own gesture starts now and lasts `durationMs`: touches until then (plus a grace) are its own. */
    synchronized void ownGesture(long now, long durationMs) { ownUntil = Math.max(ownUntil, now + Math.max(0, durationMs) + OWN_GRACE_MS); }

    /** A touch on the screen outside the bubble. True when it paused phone use (the AI was active in a live session). */
    synchronized boolean touched(long now) {
        if (mode != Mode.ACTIVE || now <= ownUntil || now - lastStep > SESSION_MS) return false;
        mode = Mode.PAUSED; byTouch = true;
        return true;
    }

    /** The AI's gesture was cancelled by Android while active: a finger of the person came in its way. */
    synchronized boolean gestureCancelled() {
        if (mode != Mode.ACTIVE) return false;
        mode = Mode.PAUSED; byTouch = true;
        return true;
    }

    /** The person's Pause in the bubble. */
    synchronized boolean pause() {
        if (mode != Mode.ACTIVE) return false;
        mode = Mode.PAUSED; byTouch = false;
        return true;
    }

    /** The person's Continue: the AI may go on with the same job. */
    synchronized boolean resume() {
        if (mode != Mode.PAUSED) return false;
        mode = Mode.ACTIVE;
        return true;
    }

    /** The person's ✕: the current job ends for good (from active or paused). */
    synchronized boolean end() {
        if (mode == Mode.ENDED) return false;
        mode = Mode.ENDED;
        if (job == null) endedWithoutJob = true;
        else {
            endedJobs.add(job);
            if (endedJobs.size() > ENDED_KEPT) endedJobs.remove(endedJobs.iterator().next());
        }
        return true;
    }

    /** Why a running step stopped part-way (the person took the phone or ended while it ran). */
    synchronized Refusal midStep() {
        if (mode == Mode.ENDED) return new Refusal("ended", "The person ended phone use for this task with ✕ while this step ran; it stopped "
                + "part-way. Do not use the phone for this task again – tell them what is left, or finish it another way.");
        return new Refusal("paused", (byTouch ? "The person touched the phone while this step ran" : "The person paused phone use while this step ran")
                + ", so it stopped part-way – look at the screen before going on. The task stays: they continue it with 'Continue' "
                + "at the top of the screen. Do not end the task – check again in a minute or two, or go on with other work.");
    }

    /** True while a step may act (checked again between a step's parts, e.g. lines of typed text). */
    synchronized boolean acting() { return mode == Mode.ACTIVE; }
}
