// Owns: reading one QR code's text from a camera frame's luminance plane (YUV_420_888 plane 0, rowStride >= width) or
// from a picture's ARGB pixels, with ZXing core: QR only, TRY_HARDER, HybridBinarizer and then GlobalHistogramBinarizer.
// Any rotation reads as is. Pure Java (no android.*), so the host tests run it. Never: decides what the text means
// (ConnectionAddress.scanned), touches the camera, or keeps a frame.
package com.teydralab.autark.android.pair;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;

public final class QrDecode {
    private static final Map<DecodeHintType, Object> HINTS = new EnumMap<>(DecodeHintType.class);
    static {
        HINTS.put(DecodeHintType.POSSIBLE_FORMATS, Collections.singletonList(BarcodeFormat.QR_CODE)); // List.of needs Android 11
        HINTS.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        HINTS.put(DecodeHintType.CHARACTER_SET, "UTF-8");
    }

    private QrDecode() {}

    /** A camera frame's Y plane: rowStride bytes per row, w x h pixels used. The QR's text, or null. */
    public static String fromLuminance(byte[] y, int rowStride, int w, int h) {
        if (y == null || w <= 0 || h <= 0 || rowStride < w || y.length < rowStride * (h - 1) + w) return null;
        byte[] data = y;
        if (y.length < rowStride * h) { data = new byte[rowStride * h]; System.arraycopy(y, 0, data, 0, y.length); } // last row may end early
        return read(new PlanarYUVLuminanceSource(data, rowStride, h, 0, 0, w, h, false));
    }

    /** A picture's pixels (0xAARRGGBB, w x h). The QR's text, or null. */
    public static String fromArgb(int[] px, int w, int h) {
        if (px == null || w <= 0 || h <= 0 || px.length < w * h) return null;
        return read(new RGBLuminanceSource(w, h, px));
    }

    private static String read(LuminanceSource source) {
        QRCodeReader reader = new QRCodeReader();
        try { return reader.decode(new BinaryBitmap(new HybridBinarizer(source)), HINTS).getText(); }
        catch (ReaderException | RuntimeException first) { reader.reset(); }
        try { return reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(source)), HINTS).getText(); }
        catch (ReaderException | RuntimeException second) { return null; }
    }
}
