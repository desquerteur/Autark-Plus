// Owns: the live QR scanner of the pairing screens – the back camera through Camera2 into a TextureView (centre-crop,
// turned to the display), an ImageReader (YUV_420_888 near 1280x720, two images) whose Y plane goes to QrDecode only
// while no decode is running, continuous autofocus, all on one thread "autark-scan"; the square frame drawn over it; the
// camera grant (request 44) with one "Allow camera" action in a fixed overlay when it is refused. A hit vibrates through
// the view's haptics and stops the camera. The camera follows the window: hidden → closed, shown again → reopened.
// Never: keeps a frame, records, decides what a QR means (the hit callback), or leaves the camera open after stop().
package com.teydralab.autark.android.pair;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.Settings;
import android.util.Size;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.function.Predicate;

final class ScanView extends FrameLayout implements TextureView.SurfaceTextureListener {
    static final int CAMERA_REQUEST = 44;
    private final Activity activity;
    private final Predicate<String> hit;
    private final TextureView texture;
    private final View denied;
    private final Paint frame = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Run run;
    private boolean wanted;
    private boolean asked;
    private Size previewSize;
    private int sensor = 90;

    /** hit runs on the UI thread with each QR text read; true = taken (the scanner stops), false = keep scanning. */
    ScanView(Activity activity, PairLook look, Predicate<String> hit) {
        super(activity);
        this.activity = activity;
        this.hit = hit;
        setBackgroundColor(PairLook.CAMERA);
        texture = new TextureView(activity);
        texture.setSurfaceTextureListener(this);
        addView(texture, new LayoutParams(-1, -1));
        LinearLayout ask = new LinearLayout(activity);
        ask.setOrientation(LinearLayout.VERTICAL);
        ask.setGravity(Gravity.CENTER);
        ask.setPadding(look.dp(32), 0, look.dp(32), 0);
        ask.addView(look.text("The camera reads the QR code on your PC.", 16, 0xFFFFFFFF, false));
        View allow = look.quiet("Allow camera", 0xFF8CCBB8, this::askAgain);
        ask.addView(allow, new LinearLayout.LayoutParams(-2, look.dp(48)));
        ask.setVisibility(INVISIBLE);
        denied = ask;
        addView(ask, new LayoutParams(-1, -1));
        frame.setStyle(Paint.Style.STROKE);
        frame.setStrokeWidth(look.dp(3));
        frame.setColor(0xE6FFFFFF);
        setWillNotDraw(false);
    }

    void start() { wanted = true; asked = false; open(); }

    void stop() { wanted = false; close(); }

    /** The answer to request 44. */
    void permission(boolean granted) {
        if (granted) open();
        else denied.setVisibility(VISIBLE);
    }

    private boolean allowed() { return activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }

    private void askAgain() {
        if (activity.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            activity.requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_REQUEST);
            return;
        }
        try { activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.getPackageName(), null))); }
        catch (RuntimeException noSettings) { /* no settings screen: the line stays */ }
    }

    private void open() {
        if (!wanted || run != null || !texture.isAvailable() || getWindowVisibility() != VISIBLE) return;
        if (!allowed()) {
            if (asked) { denied.setVisibility(VISIBLE); return; }
            asked = true;
            activity.requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_REQUEST);
            return;
        }
        denied.setVisibility(INVISIBLE);
        run = new Run();
        if (!run.open(texture.getSurfaceTexture())) close();
    }

    private void close() {
        Run open = run;
        run = null;
        if (open != null) open.close();
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (visibility == VISIBLE) open();
        else close();
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) { open(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) { transform(); }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { close(); return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) {}

    /** Centre-crop: the camera's picture (upright in the device's natural orientation) turned to the display and scaled to cover. */
    @SuppressWarnings("deprecation")
    private void transform() {
        int vw = texture.getWidth(), vh = texture.getHeight();
        if (previewSize == null || vw == 0 || vh == 0) return;
        int rotation = Build.VERSION.SDK_INT >= 30 ? activity.getDisplay().getRotation() : activity.getWindowManager().getDefaultDisplay().getRotation();
        int degrees = rotation * 90;
        boolean sideways = sensor % 180 != 0;
        float cw = sideways ? previewSize.getHeight() : previewSize.getWidth(), ch = sideways ? previewSize.getWidth() : previewSize.getHeight();
        float dw = degrees % 180 != 0 ? ch : cw, dh = degrees % 180 != 0 ? cw : ch;
        float cx = vw / 2f, cy = vh / 2f, scale = Math.max(vw / dw, vh / dh);
        Matrix matrix = new Matrix();
        matrix.setScale(cw / vw, ch / vh, cx, cy);
        matrix.postRotate(-degrees, cx, cy);
        matrix.postScale(scale, scale, cx, cy);
        texture.setTransform(matrix);
    }

    @Override protected void dispatchDraw(Canvas canvas) {
        super.dispatchDraw(canvas);
        if (denied.getVisibility() == VISIBLE) return;
        float side = Math.min(getWidth(), getHeight()) * 0.62f, left = (getWidth() - side) / 2f, top = (getHeight() - side) / 2f;
        float radius = frame.getStrokeWidth() * 6;
        canvas.drawRoundRect(left, top, left + side, top + side, radius, radius, frame);
    }

    private static Size closest(Size[] sizes, int width, int height) {
        Size best = null;
        double bestScore = Double.MAX_VALUE, aspect = width / (double) height;
        for (Size size : sizes == null ? new Size[0] : sizes) {
            double score = Math.abs(size.getWidth() * (double) size.getHeight() - width * (double) height)
                    + Math.abs(size.getWidth() / (double) size.getHeight() - aspect) * width * height;
            if (score < bestScore) { bestScore = score; best = size; }
        }
        return best;
    }

    /** One opening of the camera: its thread, device, session and reader; closed once, never reused. */
    private final class Run {
        private final HandlerThread thread = new HandlerThread("autark-scan");
        private final Handler handler;
        private volatile boolean closed;
        private boolean opening;
        private boolean busy;
        private CameraDevice camera;
        private CameraCaptureSession session;
        private ImageReader reader;
        private Surface preview;
        private byte[] y;
        private boolean focus;

        Run() { thread.start(); handler = new Handler(thread.getLooper()); }

        @SuppressLint("MissingPermission") // allowed() was checked just before
        boolean open(SurfaceTexture surface) {
            CameraManager manager = activity.getSystemService(CameraManager.class);
            try {
                String id = null;
                for (String each : manager.getCameraIdList()) {
                    Integer facing = manager.getCameraCharacteristics(each).get(CameraCharacteristics.LENS_FACING);
                    if (id == null || (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK)) id = each;
                    if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) break;
                }
                if (id == null) return false;
                CameraCharacteristics about = manager.getCameraCharacteristics(id);
                StreamConfigurationMap map = about.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                Size yuv = closest(map.getOutputSizes(ImageFormat.YUV_420_888), 1280, 720);
                Size shown = closest(map.getOutputSizes(SurfaceTexture.class), yuv.getWidth(), yuv.getHeight());
                Integer orientation = about.get(CameraCharacteristics.SENSOR_ORIENTATION);
                int[] modes = about.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
                focus = modes != null && Arrays.stream(modes).anyMatch(mode -> mode == CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                sensor = orientation == null ? 90 : orientation;
                previewSize = shown;
                transform();
                surface.setDefaultBufferSize(shown.getWidth(), shown.getHeight());
                preview = new Surface(surface);
                reader = ImageReader.newInstance(yuv.getWidth(), yuv.getHeight(), ImageFormat.YUV_420_888, 2);
                reader.setOnImageAvailableListener(this::frame, handler);
                opening = true;
                manager.openCamera(id, new CameraDevice.StateCallback() {
                    @Override public void onOpened(CameraDevice device) { opening = false; if (closed) { device.close(); release(); } else session(device); }
                    @Override public void onDisconnected(CameraDevice device) { opening = false; device.close(); lost(); }
                    @Override public void onError(CameraDevice device, int error) { opening = false; device.close(); lost(); }
                }, handler);
                return true;
            } catch (CameraAccessException | RuntimeException failed) {
                opening = false; // openCamera refused: close() releases the reader, the surface and the thread
                return false;
            }
        }

        @SuppressWarnings("deprecation") // the List<Surface> form works on Android 8+
        private void session(CameraDevice device) {
            camera = device;
            try {
                device.createCaptureSession(Arrays.asList(preview, reader.getSurface()), new CameraCaptureSession.StateCallback() {
                    @Override public void onConfigured(CameraCaptureSession configured) {
                        if (closed) { configured.close(); return; }
                        session = configured;
                        try {
                            CaptureRequest.Builder request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                            request.addTarget(preview);
                            request.addTarget(reader.getSurface());
                            if (focus) request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                            configured.setRepeatingRequest(request.build(), null, handler);
                        } catch (CameraAccessException | RuntimeException failed) { lost(); }
                    }
                    @Override public void onConfigureFailed(CameraCaptureSession failed) { lost(); }
                }, handler);
            } catch (CameraAccessException | RuntimeException failed) { lost(); }
        }

        /** The latest frame's Y plane to QrDecode; frames that arrive during a decode are dropped. */
        private void frame(ImageReader from) {
            Image image;
            try { image = from.acquireLatestImage(); } catch (RuntimeException full) { return; }
            if (image == null) return;
            int stride, width, height;
            try {
                if (busy || closed) return;
                Image.Plane plane = image.getPlanes()[0];
                stride = plane.getRowStride();
                width = image.getWidth();
                height = image.getHeight();
                ByteBuffer buffer = plane.getBuffer();
                if (y == null || y.length != stride * height) y = new byte[stride * height];
                buffer.get(y, 0, Math.min(buffer.remaining(), y.length));
            } catch (RuntimeException gone) {
                return;
            } finally { image.close(); }
            String text = QrDecode.fromLuminance(y, stride, width, height);
            if (text == null) return;
            busy = true;
            post(() -> {
                if (closed || run != this) return;
                if (hit.test(text)) { // the hit may already have replaced this view: the haptic goes through the window
                    activity.getWindow().getDecorView().performHapticFeedback(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS);
                    stop();
                } else handler.post(() -> busy = false);
            });
        }

        /** The camera went away (another app, an error): this run ends; showing the window again reopens it. */
        private void lost() {
            release();
            post(() -> { if (run == this) run = null; });
        }

        void close() {
            closed = true;
            handler.post(() -> { if (!opening) release(); });
        }

        /** On the scan thread: everything closed, then the thread ends. */
        private void release() {
            if (session != null) { try { session.close(); } catch (RuntimeException ignored) { } session = null; }
            if (camera != null) { camera.close(); camera = null; }
            if (reader != null) { reader.close(); reader = null; }
            if (preview != null) { preview.release(); preview = null; }
            thread.quitSafely();
        }
    }
}
