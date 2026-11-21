// Owns: the phone's own voice for the page (B-084 decision 5) – Android's TextToSpeech behind the port's 'speak' and
// 'stopSpeech', used when the PC's voice is unavailable and the WebView has no speechSynthesis. Lines queue in order;
// each line reports done (spoken, failed or stopped) with its id, so the page's queue never waits forever. The engine
// starts on the first line. Never: records, decides what is read, or keeps text after it was spoken.
package com.teydralab.autark.android;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class PhoneSpeech {
    /** A line ended (spoken, failed or stopped); called on the main thread. */
    interface Done { void done(String id); }

    private final Context context;
    private final Done done;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<String[]> waiting = new ArrayList<>();
    private TextToSpeech engine;
    private boolean ready;
    private boolean missing; // no TTS engine on this phone: every line ends at once

    PhoneSpeech(Context context, Done done) {
        this.context = context.getApplicationContext();
        this.done = done;
    }

    /** Queues one line; lang is a BCP 47 tag or null for the phone's language. Main thread. */
    void speak(String id, String text, String lang) {
        if (id == null || text == null || text.trim().isEmpty() || missing) { if (id != null) done.done(id); return; }
        if (!ready) { waiting.add(new String[] { id, text, lang }); start(); return; }
        say(id, text, lang);
    }

    /** Ends the current line and drops the queue (each dropped line still reports done). */
    void stop() {
        for (String[] line : waiting) done.done(line[0]);
        waiting.clear();
        if (engine != null && ready) engine.stop();
    }

    void shutdown() {
        stop();
        if (engine != null) engine.shutdown();
        engine = null;
        ready = false;
    }

    private void start() {
        if (engine != null) return;
        TextToSpeech[] made = new TextToSpeech[1];
        engine = made[0] = new TextToSpeech(context, (status) -> main.post(() -> {
            if (engine != made[0]) return; // an engine shut down before it was ready never touches the next one
            if (status != TextToSpeech.SUCCESS) { engine.shutdown(); engine = null; missing = true; stop(); return; }
            ready = true;
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { main.post(() -> done.done(id)); }
                @Override @SuppressWarnings("deprecation") public void onError(String id) { main.post(() -> done.done(id)); }
                @Override public void onError(String id, int code) { main.post(() -> done.done(id)); }
                @Override public void onStop(String id, boolean interrupted) { main.post(() -> done.done(id)); }
            });
            List<String[]> lines = new ArrayList<>(waiting);
            waiting.clear();
            for (String[] line : lines) say(line[0], line[1], line[2]);
        }));
    }

    private void say(String id, String text, String lang) {
        Locale locale = lang == null || lang.isEmpty() ? Locale.getDefault() : Locale.forLanguageTag(lang);
        if (engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) engine.setLanguage(locale);
        String line = text.length() > TextToSpeech.getMaxSpeechInputLength() ? text.substring(0, TextToSpeech.getMaxSpeechInputLength()) : text;
        if (engine.speak(line, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) done.done(id);
    }
}
