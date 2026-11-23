// Owns: the one thread that does UseLink's socket work in order – its replies and every phoneUse.attach, also the ones
// a change asks for from Android's main thread (the service turning on or off, the disclosure's "Agree"; the main thread
// may not touch the network, NetworkOnMainThreadException). A step that fails does not end the thread; a step posted
// after stop() is dropped. Pure Java, so a host test pins it.
// Never: runs a step on the caller's thread, or throws at the caller.
package com.teydralab.autark.android.phoneuse;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;

final class StepThread {
    private final Consumer<String> said;
    private final ExecutorService executor = Executors.newSingleThreadExecutor((work) -> {
        Thread thread = new Thread(work, "autark-phone-use-steps");
        thread.setDaemon(true);
        return thread;
    });

    /** `said` hears one line per failed step (UseLink: logcat). */
    StepThread(Consumer<String> said) { this.said = said; }

    /** Runs `step` after the steps posted before it; false when stopped. */
    boolean post(Runnable step) {
        try {
            // A failed step is said (its class and place, no content), and the next ones still run.
            executor.execute(() -> { try { step.run(); } catch (RuntimeException error) { said.accept("phone-use step failed: " + error.getClass().getName() + where(error)); } });
            return true;
        } catch (RejectedExecutionException stopped) {
            return false;
        }
    }

    void stop() { executor.shutdownNow(); }

    /** " at Class.method:line" of the first frame, or "" – a place in the code, never the error's message (it can hold data). */
    static String where(Throwable error) {
        StackTraceElement[] trace = error.getStackTrace();
        return trace.length == 0 ? "" : " at " + trace[0].getClassName() + "." + trace[0].getMethodName() + ":" + trace[0].getLineNumber();
    }
}
