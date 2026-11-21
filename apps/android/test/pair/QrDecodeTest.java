// Owns: executable checks that pair/QrDecode reads the PC's pair QR the way the scanner and the photo strip hand it
// over (a Y plane with rowStride > width, turned 90 degrees, a small code in a 1920x1080 frame, ARGB pixels) and that
// ConnectionAddress.scanned turns it into the Remote ID, and a foreign host into nothing. Never: claims a camera works.
package com.teydralab.autark.android.pair;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.teydralab.autark.android.ConnectionAddress;
import java.util.EnumMap;
import java.util.Map;
import java.util.Random;

public final class QrDecodeTest {
    private static final String LINK = "https://metajarvis.teydralab.com/autark/pair/#482913071";
    private static int assertions;

    public static void main(String[] args) throws WriterException {
        BitMatrix code = encode(LINK, 300);
        // A camera frame: 640x480 used, 704 bytes per row, the padding bytes are noise.
        byte[] frame = gray(640, 480, 704);
        noisePadding(frame, 640, 480, 704);
        paint(frame, 704, code, 170, 90);
        equal(LINK, QrDecode.fromLuminance(frame, 704, 640, 480));
        equal("482913071", ConnectionAddress.scanned(QrDecode.fromLuminance(frame, 704, 640, 480)));
        // The last row of a real Y plane can end at width, not at rowStride.
        byte[] cut = new byte[704 * 479 + 640];
        System.arraycopy(frame, 0, cut, 0, cut.length);
        equal(LINK, QrDecode.fromLuminance(cut, 704, 640, 480));
        // The phone held sideways: the frame turned 90 degrees.
        byte[] turned = turn(frame, 704, 640, 480);
        equal(LINK, QrDecode.fromLuminance(turned, 480, 480, 640));
        // A small code (about 120 px, like the 96 CSS px QR on the PC) inside a 1920x1080 frame.
        byte[] wide = gray(1920, 1080, 1920);
        paint(wide, 1920, encode(LINK, 120), 1310, 610);
        equal(LINK, QrDecode.fromLuminance(wide, 1920, 1920, 1080));
        // A screenshot from the photo strip: ARGB pixels, the old /pair# spelling.
        String old = "https://metajarvis.teydralab.com/autark/pair#482913071";
        int[] argb = argb(encode(old, 240), 1080, 1600, 400, 700);
        equal(old, QrDecode.fromArgb(argb, 1080, 1600));
        equal("482913071", ConnectionAddress.scanned(QrDecode.fromArgb(argb, 1080, 1600)));
        // A QR of another host decodes, but is no pair code.
        String foreign = "https://evil.test/autark/pair/#482913071";
        int[] other = argb(encode(foreign, 240), 600, 600, 180, 180);
        equal(foreign, QrDecode.fromArgb(other, 600, 600));
        check(ConnectionAddress.scanned(QrDecode.fromArgb(other, 600, 600)) == null);
        // Nothing to read, or nothing at all.
        check(QrDecode.fromLuminance(gray(640, 480, 640), 640, 640, 480) == null);
        check(QrDecode.fromArgb(new int[600 * 600], 600, 600) == null);
        check(QrDecode.fromLuminance(null, 640, 640, 480) == null);
        check(QrDecode.fromLuminance(new byte[10], 640, 640, 480) == null);
        check(QrDecode.fromArgb(new int[10], 600, 600) == null);
        System.out.println(assertions + " QR decode assertions passed.");
    }

    private static BitMatrix encode(String text, int size) throws WriterException {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M); // the PC's runtime/pwa/qr.ts
        hints.put(EncodeHintType.MARGIN, 4);
        return new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
    }

    private static byte[] gray(int w, int h, int stride) {
        byte[] y = new byte[stride * h];
        for (int row = 0; row < h; row++) for (int x = 0; x < w; x++) y[row * stride + x] = (byte) (200 + (x * 7 + row * 3) % 40);
        return y;
    }

    private static void noisePadding(byte[] y, int w, int h, int stride) {
        Random random = new Random(7);
        for (int row = 0; row < h; row++) for (int x = w; x < stride; x++) y[row * stride + x] = (byte) random.nextInt(256);
    }

    private static void paint(byte[] y, int stride, BitMatrix code, int left, int top) {
        for (int row = 0; row < code.getHeight(); row++) for (int x = 0; x < code.getWidth(); x++)
            y[(top + row) * stride + left + x] = (byte) (code.get(x, row) ? 30 : 235);
    }

    private static byte[] turn(byte[] y, int stride, int w, int h) {
        byte[] out = new byte[w * h]; // h wide, w tall
        for (int row = 0; row < h; row++) for (int x = 0; x < w; x++) out[x * h + (h - 1 - row)] = y[row * stride + x];
        return out;
    }

    private static int[] argb(BitMatrix code, int w, int h, int left, int top) {
        int[] px = new int[w * h];
        java.util.Arrays.fill(px, 0xFFF4F6F5);
        for (int row = 0; row < code.getHeight(); row++) for (int x = 0; x < code.getWidth(); x++)
            if (code.get(x, row)) px[(top + row) * w + left + x] = 0xFF16201D;
        return px;
    }

    private static void check(boolean value) { assertions++; if (!value) throw new AssertionError("Unexpected result"); }
    private static void equal(String expected, String actual) { assertions++; if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual); }
}
