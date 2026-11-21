# Third-party notice

Components that ship with or are fetched by Autark besides its npm dependencies. The project itself is Apache-2.0 (LICENSE).

## ONNX Runtime Web (onnxruntime-web, onnxruntime-common)

Runs the local embedding model in a worker thread (apps/desktop, src/runtime/vectors/local-model.ts); shipped in the desktop package.
Copyright (c) Microsoft Corporation. MIT License, https://github.com/microsoft/onnxruntime/blob/main/LICENSE

## paraphrase-multilingual-MiniLM-L12-v2

The small embedding model this PC runs itself (384 numbers, 50+ languages). Not shipped: downloaded on first need from Hugging Face, the int8 ONNX export and tokenizer by Xenova (https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) of the sentence-transformers model (https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).
Copyright the sentence-transformers authors. Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0

## elkjs

The ELK graph layout that mermaid (a dependency of the desktop UI) bundles for its diagrams; shipped unmodified inside the desktop package. Its source: https://github.com/kieler/elkjs (npm package `elkjs`).
Copyright (c) Kiel University and others. Eclipse Public License 2.0, https://www.eclipse.org/legal/epl-2.0/

## Mediabunny

Reads and writes the video container and drives the browser's own codecs (WebCodecs) when a heavy video in a chat gets its light preview copy (apps/desktop, src/ui/preview/page.ts, built into the preview window's page script `app/media-preview-page.js`); bundled unmodified into that file in the desktop package. Its source: https://github.com/Vanilagy/mediabunny (npm package `mediabunny`).
Copyright (c) Vanilagy. Mozilla Public License 2.0, https://www.mozilla.org/en-US/MPL/2.0/

## Geist, Geist Mono and Instrument Serif

The fonts of the website (apps/website/public/fonts), self-hosted as WOFF2 subsets. The licence with the copyright lines is next to them in `apps/website/public/fonts/OFL.txt`.
Geist and Geist Mono: Copyright 2024 The Geist Project Authors (originally Copyright (c) 2023 Vercel, in collaboration with basement.studio), https://github.com/vercel/geist-font
Instrument Serif: Copyright 2022 The Instrument Serif Project Authors, https://github.com/Instrument/instrument-serif
SIL Open Font License 1.1, https://openfontlicense.org

## WebRTC (libwebrtc, Android app)

The Android app's direct connection to the PC (a WebRTC data channel, apps/android `relay/WebRtc.java`) runs on libwebrtc as built by Threema AG: Maven `ch.threema:webrtc-android` 149.0.0 (https://github.com/threema-ch/webrtc-android), from WebRTC commit 28311abc149a9bb7e6761a3d54f362a8d77e6793 with Threema's patches; shipped in the APK as `libjingle_peerconnection_so.so` (arm64-v8a, armeabi-v7a) and the `org.webrtc` Java classes. The APK carries the licence texts in `assets/licenses/webrtc.txt`.
WebRTC: Copyright (c) 2011, The WebRTC project authors. BSD 3-Clause License with Google's additional patent grant, https://webrtc.googlesource.com/src/+/28311abc149a9bb7e6761a3d54f362a8d77e6793/LICENSE and /PATENTS. The native library includes BoringSSL, Abseil, libsrtp, Opus, libvpx, libyuv, crc32c, pffft, rnnoise, cpu_features, jni_zero and LLVM libc++, each under its own licence (listed in `assets/licenses/webrtc.txt`).
Threema's build: Copyright (c) 2024 Threema AG. Apache License 2.0 or MIT License, https://github.com/threema-ch/webrtc-android/blob/master/LICENSE-APACHE, /LICENSE-MIT
