// Owns: the fixed 96 dp strip under the scanner – 80 dp rounded tiles: "Files" (the document picker, request 46) first;
// when this build declares READ_MEDIA_IMAGES (the website APK) and it is granted, the 12 newest pictures (MediaStore, by
// DATE_ADDED) as thumbnails, on Android 14 with a partial grant only the chosen ones plus "More"; otherwise one "Photos"
// tile (the system photo picker, no permission). A tap or a pick reads the picture (long side <= 1600 px) through
// QrDecode on the strip's one background thread. The photo grant (request 45) is asked once per app run, when the
// scanner opens. Its height never changes: tiles only fill in. Never: uploads, keeps or lists more than the 12 pictures.
package com.teydralab.autark.android.pair;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.MediaStore;
import android.util.Size;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;

final class RecentStrip extends HorizontalScrollView {
    static final int PHOTOS_REQUEST = 45;
    static final int PICK_REQUEST = 46;
    private static final int TILE = 0xFF1E2522;
    private static boolean asked; // once per app run
    private final Activity activity;
    private final PairLook look;
    private final Consumer<String> picked;
    private final LinearLayout tiles;
    private HandlerThread thread;
    private Handler worker;
    private int generation;

    /** picked runs on the UI thread with the QR text of a chosen picture, or null when the picture has none. */
    RecentStrip(Activity activity, PairLook look, Consumer<String> picked) {
        super(activity);
        this.activity = activity;
        this.look = look;
        this.picked = picked;
        setHorizontalScrollBarEnabled(false);
        setBackgroundColor(PairLook.CAMERA);
        tiles = new LinearLayout(activity);
        tiles.setPadding(look.dp(8), look.dp(8), look.dp(8), look.dp(8));
        addView(tiles, new LayoutParams(-2, -1));
    }

    static int height(PairLook look) { return look.dp(96); }

    void start() {
        if (thread == null) { thread = new HandlerThread("autark-photos"); thread.start(); worker = new Handler(thread.getLooper()); }
        fill();
    }

    void stop() {
        generation++;
        if (thread != null) { thread.quitSafely(); thread = null; worker = null; }
    }

    /** Asks for the photos once per app run when this build declares them and nothing is granted yet. */
    void ask() {
        if (asked || !declared() || access() != 0) return;
        asked = true;
        request();
    }

    void permission() { if (thread != null) fill(); }

    /** A picker's answer (request 46): read the chosen picture. */
    void result(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null || worker == null) return;
        read(data.getData());
    }

    /** 0 = no access, 1 = all pictures, 2 = only the ones the person chose (Android 14+). */
    private int access() {
        if (!declared()) return 0;
        if (granted(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE)) return 1;
        return Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) ? 2 : 0;
    }

    private boolean granted(String permission) { return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED; }

    @SuppressWarnings("deprecation")
    private boolean declared() {
        try {
            String[] requested = activity.getPackageManager().getPackageInfo(activity.getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
            return requested != null && Arrays.asList(requested).contains(Manifest.permission.READ_MEDIA_IMAGES);
        } catch (PackageManager.NameNotFoundException missing) { return false; }
    }

    private void request() {
        String[] permissions = Build.VERSION.SDK_INT >= 34 ? new String[] {Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}
                : Build.VERSION.SDK_INT >= 33 ? new String[] {Manifest.permission.READ_MEDIA_IMAGES} : new String[] {Manifest.permission.READ_EXTERNAL_STORAGE};
        activity.requestPermissions(permissions, PHOTOS_REQUEST);
    }

    private void fill() {
        int run = ++generation;
        tiles.removeAllViews();
        tiles.addView(label("Files", () -> pick(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"))));
        int access = access();
        if (access == 0) { tiles.addView(label("Photos", this::photoPicker)); return; }
        Handler handler = worker;
        handler.post(() -> {
            List<Uri> recent = newest();
            post(() -> {
                if (run != generation) return;
                for (Uri uri : recent) {
                    ImageView image = new ImageView(activity);
                    image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                    tiles.addView(tile(image, () -> read(uri)));
                    handler.post(() -> { Bitmap thumb = thumbnail(uri); if (thumb != null) post(() -> { if (run == generation) image.setImageBitmap(thumb); }); });
                }
                if (access == 2) tiles.addView(label("More", this::request));
            });
        });
    }

    private void photoPicker() {
        if (Build.VERSION.SDK_INT >= 33) pick(new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*"));
        else pick(new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"));
    }

    private void pick(Intent intent) {
        try { activity.startActivityForResult(intent, PICK_REQUEST); }
        catch (ActivityNotFoundException none) { picked.accept(null); }
    }

    private List<Uri> newest() {
        List<Uri> uris = new ArrayList<>();
        Bundle args = new Bundle();
        args.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, new String[] {MediaStore.Images.Media.DATE_ADDED});
        args.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING);
        args.putInt(ContentResolver.QUERY_ARG_LIMIT, 12);
        Uri images = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        try (Cursor rows = activity.getContentResolver().query(images, new String[] {MediaStore.Images.Media._ID}, args, null)) {
            while (rows != null && uris.size() < 12 && rows.moveToNext()) uris.add(ContentUris.withAppendedId(images, rows.getLong(0)));
        } catch (RuntimeException unreadable) { /* the strip keeps "Files" */ }
        return uris;
    }

    @SuppressWarnings("deprecation")
    private Bitmap thumbnail(Uri uri) {
        try {
            if (Build.VERSION.SDK_INT >= 29) return activity.getContentResolver().loadThumbnail(uri, new Size(240, 240), null);
            return MediaStore.Images.Thumbnails.getThumbnail(activity.getContentResolver(), ContentUris.parseId(uri), MediaStore.Images.Thumbnails.MINI_KIND, null);
        } catch (Exception | OutOfMemoryError failed) { return null; }
    }

    /** On the worker: the picture at most 1600 px on its long side, its QR text to picked (UI thread). */
    private void read(Uri uri) {
        Handler handler = worker;
        if (handler == null) return;
        int run = generation;
        handler.post(() -> {
            String text = null;
            try {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
                int side = Math.max(bounds.outWidth, bounds.outHeight), sample = 1;
                while (side / (sample * 2) >= 1600) sample *= 2;
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = sample;
                Bitmap bitmap;
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(in, null, options); }
                if (bitmap != null) {
                    int longSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
                    if (longSide > 1600) {
                        Bitmap smaller = Bitmap.createScaledBitmap(bitmap, bitmap.getWidth() * 1600 / longSide, bitmap.getHeight() * 1600 / longSide, true);
                        if (smaller != bitmap) bitmap.recycle();
                        bitmap = smaller;
                    }
                    int w = bitmap.getWidth(), h = bitmap.getHeight();
                    int[] px = new int[w * h];
                    bitmap.getPixels(px, 0, w, 0, 0, w, h);
                    bitmap.recycle();
                    text = QrDecode.fromArgb(px, w, h);
                }
            } catch (Exception | OutOfMemoryError unreadable) { text = null; }
            String found = text;
            post(() -> { if (run == generation) picked.accept(found); });
        });
    }

    private View label(String text, Runnable action) {
        return tile(look.text(text, 13, 0xFFFFFFFF, true), action);
    }

    private View tile(View inside, Runnable action) {
        FrameLayout tile = new FrameLayout(activity);
        tile.setBackground(look.round(TILE, 14, 0));
        tile.setClipToOutline(true);
        tile.setForeground(look.touch(null, 0x40FFFFFF));
        tile.addView(inside, new FrameLayout.LayoutParams(-1, -1));
        tile.setOnClickListener(clicked -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(look.dp(80), look.dp(80));
        params.setMarginEnd(look.dp(8));
        tile.setLayoutParams(params);
        return tile;
    }
}
