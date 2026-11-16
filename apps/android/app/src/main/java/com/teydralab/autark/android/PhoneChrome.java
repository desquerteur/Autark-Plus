// Owns: file selection for the page and per-origin foreground media consent. A chooser that accepts only images or
// videos opens Android's photo picker (13+, photos and videos), every other one the document picker; a chooser with
// capture (16.11.2026, F23: "Take photo", "Record video") opens the camera app – after asking for the camera when the
// app does not have it yet (a declared but missing CAMERA makes the camera intent fail) – with its result in a file of
// CaptureFiles; without a camera app or the camera permission the picker opens instead. Files shared to Autark answer
// the next chooser instead of a picker (ShareIn). Never: grants arbitrary web resources, or hands the page a file:// path.
package com.teydralab.autark.android;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Locale;
import java.util.function.Supplier;

final class PhoneChrome extends WebChromeClient {
    private static final int FILE_REQUEST = 41;
    private static final int MEDIA_REQUEST = 42;
    private static final int CAMERA_REQUEST = 47;
    private static final int CAPTURE_REQUEST = 48;
    private final Activity activity;
    private final Supplier<String> origin;
    private final WebView web;
    private PermissionRequest media;
    private String[] resources = new String[0];
    private ValueCallback<Uri[]> files;
    /** The capture waiting for the camera app (its file), and whether it is a video. */
    private Uri captured;
    private boolean captureVideo;
    /** The picker this chooser falls back to when the camera cannot open. */
    private Runnable picker;

    PhoneChrome(Activity activity, WebView web, Supplier<String> origin) {
        this.activity = activity;
        this.web = web;
        this.origin = origin;
    }

    @Override public void onPermissionRequest(PermissionRequest request) {
        if (!trusted(request)) { request.deny(); return; }
        if (media != null) media.deny();
        ArrayList<String> accepted = new ArrayList<>();
        ArrayList<String> missing = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) ? Manifest.permission.RECORD_AUDIO
                    : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) ? Manifest.permission.CAMERA : null;
            if (permission == null) continue;
            accepted.add(resource);
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        }
        if (accepted.isEmpty()) { request.deny(); return; }
        media = request;
        resources = accepted.toArray(new String[0]);
        if (missing.isEmpty()) grantMedia();
        else activity.requestPermissions(missing.toArray(new String[0]), MEDIA_REQUEST);
    }

    private boolean trusted(PermissionRequest request) {
        return origin.get() != null && web.getUrl() != null &&
                ConnectionAddress.sameOrigin(origin.get(), request.getOrigin().toString()) &&
                ConnectionAddress.sameOrigin(origin.get(), web.getUrl()) && !activity.isFinishing();
    }

    private void grantMedia() {
        PermissionRequest request = media;
        media = null;
        if (request == null) return;
        boolean granted = trusted(request);
        for (String resource : resources) {
            String permission = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) ? Manifest.permission.RECORD_AUDIO : Manifest.permission.CAMERA;
            granted &= activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
        }
        if (granted) request.grant(resources); else request.deny();
        resources = new String[0];
    }

    @Override public void onPermissionRequestCanceled(PermissionRequest request) {
        if (media == request) { media = null; resources = new String[0]; }
    }

    void permissionResult(int requestCode) {
        if (requestCode == MEDIA_REQUEST) grantMedia();
        if (requestCode != CAMERA_REQUEST || files == null) return;
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED && startCapture()) return;
        Toast.makeText(activity, "No camera access – pick a file instead.", Toast.LENGTH_SHORT).show();
        if (picker != null) picker.run();
    }

    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (origin.get() == null || !ConnectionAddress.sameOrigin(origin.get(), view.getUrl())) return false;
        cancelFiles();
        boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
        // Files shared to Autark from another app answer the page's next chooser (decision 10).
        Uri[] shared = ShareIn.takePending(multiple ? Integer.MAX_VALUE : 1);
        if (shared != null) { callback.onReceiveValue(shared); return true; }
        files = callback;
        ArrayList<String> types = new ArrayList<>();
        boolean any = true, images = false, videos = false;
        for (String type : params.getAcceptTypes()) {
            String value = type == null ? "" : type.trim().toLowerCase(Locale.ROOT);
            if (!value.contains("/")) continue;
            types.add(value);
            images |= value.startsWith("image/");
            videos |= value.startsWith("video/");
            any &= value.startsWith("image/") || value.startsWith("video/");
        }
        boolean media = any && !types.isEmpty(), photo = images, video = videos;
        picker = () -> pick(types, media, photo, video, multiple);
        if (params.isCaptureEnabled()) {
            captureVideo = videos && !images;
            if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_REQUEST); // goes on in permissionResult
                return true;
            }
            if (startCapture()) return true;
        }
        picker.run();
        return true;
    }

    /** Android's photo picker for images and videos (13+), else the document picker. */
    private void pick(ArrayList<String> types, boolean media, boolean images, boolean videos, boolean multiple) {
        if (media && Build.VERSION.SDK_INT >= 33 && open(photos(images, videos, multiple))) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (types.size() == 1) intent.setType(types.get(0));
        else if (!types.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        if (!open(intent)) {
            cancelFiles();
            Toast.makeText(activity, "No file picker is installed.", Toast.LENGTH_LONG).show();
        }
    }

    /** The camera app for a photo or a video into a new CaptureFiles file; false when it cannot open. */
    private boolean startCapture() {
        try {
            Uri out = CaptureFiles.create(activity, captureVideo ? "mp4" : "jpg");
            Intent intent = new Intent(captureVideo ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, out)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("capture", out)); // the grant covers EXTRA_OUTPUT on every Android version
            activity.startActivityForResult(intent, CAPTURE_REQUEST);
            captured = out;
            return true;
        } catch (IOException | ActivityNotFoundException | SecurityException error) {
            captured = null;
            return false;
        }
    }

    /** Android's photo picker (13+): photos and videos without any storage permission. */
    @android.annotation.TargetApi(33)
    private static Intent photos(boolean images, boolean videos, boolean multiple) {
        Intent intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
        if (images != videos) intent.setType(images ? "image/*" : "video/*");
        if (multiple && android.os.ext.SdkExtensions.getExtensionVersion(android.os.Build.VERSION_CODES.R) >= 2
                && MediaStore.getPickImagesMaxLimit() > 1) intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
        return intent;
    }

    private boolean open(Intent intent) {
        try { activity.startActivityForResult(intent, FILE_REQUEST); return true; }
        catch (android.content.ActivityNotFoundException error) { return false; }
    }

    void activityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == CAPTURE_REQUEST) { captureResult(resultCode, data); return; }
        if (requestCode != FILE_REQUEST || files == null) return;
        // Several picked files come as ClipData (photo picker, EXTRA_ALLOW_MULTIPLE), one as the data address.
        ArrayList<Uri> readable = new ArrayList<>();
        if (resultCode == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) addReadable(readable, clip.getItemAt(i).getUri());
            addReadable(readable, data.getData());
        }
        ValueCallback<Uri[]> callback = files;
        files = null;
        callback.onReceiveValue(readable.isEmpty() ? null : readable.toArray(new Uri[0]));
    }

    /** The camera app is back: its file when it wrote one, else the address it returned (some video apps ignore
     *  EXTRA_OUTPUT), else nothing (cancelled). */
    private void captureResult(int resultCode, Intent data) {
        Uri out = captured;
        captured = null;
        if (files == null) return;
        ArrayList<Uri> readable = new ArrayList<>();
        if (resultCode == Activity.RESULT_OK) {
            if (out != null && CaptureFiles.size(activity, out) > 0) readable.add(out);
            else if (data != null) addReadable(readable, data.getData());
        }
        ValueCallback<Uri[]> callback = files;
        files = null;
        callback.onReceiveValue(readable.isEmpty() ? null : readable.toArray(new Uri[0]));
    }

    private static void addReadable(ArrayList<Uri> into, Uri uri) {
        if (uri != null && "content".equals(uri.getScheme()) && !into.contains(uri)) into.add(uri);
    }

    private void cancelFiles() {
        if (files != null) { files.onReceiveValue(null); files = null; }
        picker = null;
    }

    void cancelMedia() {
        if (media != null) { media.deny(); media = null; }
        resources = new String[0];
    }

    void dispose() { cancelMedia(); cancelFiles(); }
}
