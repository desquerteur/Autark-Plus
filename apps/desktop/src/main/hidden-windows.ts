// The hidden windows of the main process, built with their Electron seams (desktop.ts wires them):
// keyframes of stored videos in an on-demand hidden window of its own session (MM4,
// media-analyzer.ts), the light preview copies of videos in another one (17.11.2026, media-preview.ts), and a dictation sent to the Codex plan's voice over WebRTC in another one
// (owner 07.11.2026, voice-rtc.ts; the take decoded by the media analyzer); one dispose at quit.
// Owns: constructing them and disposing them. Never: shows a window, uses the person's window or
// session, or decides what is analyzed or sent (host services ask).

import { BrowserWindow, session } from 'electron';
import { MediaAnalyzer } from './media-analyzer.ts';
import { electronAnalyzerWindows } from './media-analyzer-window.ts';
import { MediaPreview } from './media-preview.ts';
import { PREVIEW_ORIGIN } from './media-preview-routes.ts';
import { VoiceRtc } from './voice-rtc.ts';
import { electronRtcWindows } from './voice-rtc-window.ts';

export interface HiddenWindowsDeps {
  blobsDir: string;
  /** 17.11.2026: main's folder for the video preview copies and the preview page's script (app-paths.ts previews, previewPage). */
  previewDir: string;
  previewScript(): string;
}

export interface HiddenWindows {
  mediaAnalyzer: MediaAnalyzer;
  mediaPreview: MediaPreview;
  voiceRtc: VoiceRtc;
  dispose(): void;
}

export function hiddenWindows(deps: HiddenWindowsDeps): HiddenWindows {
  const fromPartition = (partition: string, partitionOptions: { cache: boolean }) => session.fromPartition(partition, partitionOptions);
  const mediaAnalyzer = new MediaAnalyzer({ open: electronAnalyzerWindows({ BrowserWindow, fromPartition }), blobsDir: deps.blobsDir });
  const mediaPreview = new MediaPreview({
    open: electronAnalyzerWindows({ BrowserWindow, fromPartition }, { partition: 'wf-media-preview', origin: PREVIEW_ORIGIN }),
    blobsDir: deps.blobsDir, dir: deps.previewDir, script: deps.previewScript,
  });
  const voiceRtc = new VoiceRtc({ open: electronRtcWindows({ BrowserWindow, fromPartition }), decode: (request) => mediaAnalyzer.audio(request) });
  return { mediaAnalyzer, mediaPreview, voiceRtc, dispose: () => { voiceRtc.dispose(); mediaAnalyzer.dispose(); mediaPreview.dispose(); } };
}
