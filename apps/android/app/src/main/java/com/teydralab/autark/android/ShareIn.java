// Owns: "Share to Autark" from any app (B-084, decision 10): reads an ACTION_SEND / ACTION_SEND_MULTIPLE intent into its
// text and its content:// files, and keeps those files for the page's next file chooser (PhoneChrome answers it with them
// instead of opening a picker) – until they are taken, a newer share replaces them, or ten minutes passed (a share the
// person dropped never lands in a later, unrelated attach). The page itself hears `share {text, files}` (NativePort).
// Never: reads the files, keeps them on disk, or takes a file:// path.
package com.teydralab.autark.android;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class ShareIn {
    /** What a share brought: text (may be null) and the number of files kept for the next file chooser. */
    public static final class Shared {
        public final String text;
        public final int files;
        Shared(String text, int files) { this.text = text; this.files = files; }
    }

    private static final long KEEP_MS = 10 * 60_000L;
    private static Uri[] pending;
    private static long pendingAt;

    private ShareIn() {}

    /** True for an intent another app's share sheet sent here. */
    public static boolean isShare(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    /** Reads a share, keeps its files for the next file chooser and returns what the page hears; null for no share. */
    public static synchronized Shared accept(Intent intent) {
        if (!isShare(intent)) return null;
        CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String text = body != null ? body.toString() : subject;
        if (body != null && subject != null && !subject.isEmpty() && !body.toString().contains(subject)) text = subject + "\n" + body;
        ArrayList<Uri> uris = new ArrayList<>();
        for (Uri uri : streams(intent)) if (uri != null && "content".equals(uri.getScheme()) && !uris.contains(uri)) uris.add(uri);
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
            Uri uri = clip.getItemAt(i).getUri();
            if (uri != null && "content".equals(uri.getScheme()) && !uris.contains(uri)) uris.add(uri);
        }
        pending = uris.isEmpty() ? null : uris.toArray(new Uri[0]);
        pendingAt = System.currentTimeMillis();
        if ((text == null || text.trim().isEmpty()) && pending == null) return null;
        return new Shared(text == null || text.trim().isEmpty() ? null : text.trim(), uris.size());
    }

    /** True while shared files wait for a file chooser. */
    public static synchronized boolean hasPending() {
        if (pending != null && System.currentTimeMillis() - pendingAt > KEEP_MS) pending = null;
        return pending != null;
    }

    /** The waiting files (at most `max`; the rest wait for the next chooser), or null when none wait. */
    public static synchronized Uri[] takePending(int max) {
        if (!hasPending()) return null;
        Uri[] all = pending;
        if (all.length <= max) { pending = null; return all; }
        pending = Arrays.copyOfRange(all, max, all.length);
        return Arrays.copyOf(all, max);
    }

    /** The page dropped the share (or the phone was forgotten). */
    public static synchronized void clear() { pending = null; }

    // The typed getters only from Android 14: Android 13's had a bug (AndroidX IntentCompat skips them there too).
    @SuppressWarnings("deprecation")
    private static List<Uri> streams(Intent intent) {
        ArrayList<Uri> out = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri one = Build.VERSION.SDK_INT >= 34 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) out.add(one);
            return out;
        }
        ArrayList<? extends Parcelable> many = Build.VERSION.SDK_INT >= 34
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (many != null) for (Parcelable item : many) if (item instanceof Uri) out.add((Uri) item);
        return out;
    }
}
