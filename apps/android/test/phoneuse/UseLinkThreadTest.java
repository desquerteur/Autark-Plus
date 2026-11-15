// Owns: a host repro of the phone-use socket's thread rule (10.11.2026, Nora's report of an abort on "Agree"; Konrad's
// source trace UseDisclosure → UseService.notifyChanged → UseLink.attach → WebSocketClient.sendText on the main thread):
// StepThread's order, survival and stop; UseLink's wiring read from its source (no socket write on a listener's thread,
// attach only after the hello, a failing write never thrown at the caller); the exact 'off' texts the PC reads; and the
// restricted-settings way the app explains. Never: claims a crash cause or a phone result – that needs a device.
package com.teydralab.autark.android.phoneuse;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class UseLinkThreadTest {
    private static int assertions;

    public static void main(String[] args) throws Exception {
        steps();
        wiring(source("app/src/main/java/com/teydralab/autark/android/phoneuse/UseLink.java"));
        restricted();
        System.out.println(assertions + " phone-use thread, wiring and off-text assertions passed.");
    }

    private static void steps() throws Exception {
        List<String> said = new CopyOnWriteArrayList<>();
        StepThread steps = new StepThread(said::add);
        Thread caller = Thread.currentThread();
        List<String> order = new CopyOnWriteArrayList<>();
        List<Thread> threads = new CopyOnWriteArrayList<>();
        CountDownLatch done = new CountDownLatch(1);
        check(steps.post(() -> { threads.add(Thread.currentThread()); order.add("attach"); }));
        check(steps.post(() -> { throw new IllegalStateException("simulated NetworkOnMainThreadException"); }));
        check(steps.post(() -> { threads.add(Thread.currentThread()); order.add("reply"); done.countDown(); }));
        check(done.await(5, TimeUnit.SECONDS));
        check(order.equals(java.util.Arrays.asList("attach", "reply"))); // in posting order, past a failing step
        check(said.size() == 1 && said.get(0).startsWith("phone-use step failed: java.lang.IllegalStateException at ")
                && !said.get(0).contains("simulated")); // the failure is said, by class and place, not its message
        check(threads.size() == 2 && threads.get(0) == threads.get(1) && threads.get(0) != caller); // one thread, never the caller's
        steps.stop();
        check(!steps.post(() -> order.add("late"))); // dropped after stop, not thrown
        Thread.sleep(50);
        check(order.size() == 2);
        // stop() while a step runs and others wait: the waiting ones are dropped, the caller is not blocked or thrown at.
        StepThread busy = new StepThread(said::add);
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<String> after = new CopyOnWriteArrayList<>();
        check(busy.post(() -> { running.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException stop) { after.add("interrupted"); } }));
        check(busy.post(() -> after.add("pending")));
        check(running.await(5, TimeUnit.SECONDS));
        long before = System.nanoTime();
        busy.stop();
        check(System.nanoTime() - before < TimeUnit.SECONDS.toNanos(1));
        release.countDown();
        Thread.sleep(100);
        check(!after.contains("pending") && after.contains("interrupted"));
    }

    private static void wiring(String link) {
        check(!link.contains("onChange(this::attach)")); // the main thread's change no longer writes the socket itself
        check(link.contains("UseService.onChange(this::changed)"));
        check(link.contains("steps.post(() -> attach(ws))"));
        check(!link.contains(" attach();") && !link.contains("{attach();")); // no direct attach() left anywhere
        check(link.contains("try { ws.sendText(Json.write(frame)); } catch (IOException | RuntimeException error) {")); // a refused write never reaches the caller
        check(link.contains("android.util.Log.w(\"autark\", \"phone-use write refused: \" + error.getClass().getName() + StepThread.where(error));")); // said, not swallowed
        IllegalStateException secret = new IllegalStateException("frame with private text");
        String place = StepThread.where(secret);
        check(place.startsWith(" at ") && place.contains("UseLinkThreadTest") && !place.contains("private text")); // the place, never the message
        int hello = link.indexOf("\"protocol\", 1");
        int publish = link.indexOf("if (closes == seen) socket = ws;");
        check(hello > 0 && publish > hello); // hello and subscribe go out before a listener can see the socket
        check(link.contains("if (socket != ws) return;")); // a step for a socket that ended sends nothing on the next one
        // The precise 'off' answers the PC passes on to the AI stay as they are.
        check(link.contains("\"The person has not yet agreed to the phone-use disclosure in the app.\" : \"Phone use is off on this phone.\""));
        check(link.contains("\"This app build carries no phone use. Autark is fetching its phone-use build by itself now \""));
        check(link.contains("\"This app build (from Google Play) carries no phone use and cannot add it by itself.\""));
    }

    private static void restricted() {
        for (boolean german : new boolean[] {false, true}) {
            String text = DisclosureText.restricted(german);
            for (String needed : german
                    ? new String[] {"Einstellungen › Apps › Autark", "⋮", "Eingeschränkte Einstellungen zulassen", "Bedienungshilfen", "Use this phone", "Bildschirm", "bedienen", "abweichen"}
                    : new String[] {"Settings › Apps › Autark", "⋮", "Allow restricted settings", "Accessibility", "Use this phone", "screen", "operate", "differ"}) {
                check(text.contains(needed));
            }
        }
    }

    private static String source(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(System.getProperty("autark.android"), path)), StandardCharsets.UTF_8);
    }

    private static void check(boolean value) { assertions++; if (!value) throw new AssertionError("Unexpected result " + assertions); }
}
