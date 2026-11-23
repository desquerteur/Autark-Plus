// The one composer: auto-growing field (to ~40 % of the window), Enter sends (setting), per-chat drafts,
// attachments (Plus menu, drag/drop, paste), @mentions and /commands, dictation into the caret (the
// waveform sits in the action row's spacer) and one primary button: Send, disabled without content.
// AF-012: while an agent works in the chat and nothing is to be sent, that button is Stop (a square, data-tour="run-stop"),
// and Esc stops too – in the field after its own uses, and in the chat column outside a field (composer/stop.ts). Each
// agent's own Stop sits at its line in the live bar above (LiveBar.tsx, F21).
// AF-016: while an agent works (or messages wait), Enter does the person's default – send now or add to the chat's queue
// (composer/queue.ts) – and Ctrl+Enter the other; the caret right of Send offers both (SendSplit.tsx); the queued
// messages show right above the composer (QueueList.tsx).
// AF-017 (desquerteur/Autark-Plus#18): while a take runs the mic is ✓ (the words go into the field, then
// preferences.dictationSend: keep, send, or send after a 2 s countdown chip that Cancel, Esc or typing stops) and Send (➤)
// sends the transcript; holding the mic or Ctrl+Shift+Space in the field is push-to-talk (release = send). Every send
// goes through send() below, so while an agent works it follows the AF-016 choice (now or queue) – composer/dictation-send.ts.
// Action row, fixed cells: [+] [Access mode] [spacer] [Model] [Mic] [Send] – nothing in it moves on a click (AF-013: the
// mode cell; B-083: no Ultra cell – the agent splits itself when it pays, owner 08.11.).
// How a message goes out: /important, /silent, or the Plus menu's and the Send button's right-click menu's "Send as important",
// "Send silently" (with nothing to send yet: the draft's level) and "Schedule…": that switches the composer into schedule
// mode (composer/ScheduleBar.tsx above the text, the field taller, Send = Schedule; Esc or × leaves; text only – a draft
// with files cannot be scheduled and says so). Plus › Secret opens the secret mode the same way (settings/SecretRows.tsx
// ChatSecretBar above the text: each row becomes a chip).
// A reply shows its quote chip above the field (X or Esc cancels it) and goes out as `replyTo`.
// A one-shot fill ("/task ") goes only into an empty composer – it never overwrites the person's draft.
// B-082: unsure places of dictated text are highlighted behind the field (composer/MarkLayer.tsx); a click or tap with
// the caret in one opens its menu (composer/MarkMenu.tsx). The text itself stays plain. A kept take's chip has
// "Transcribe again" (composer/voice.ts retryTake: the words go in at the caret).
// F23: Plus › Record audio / Record video open composer/RecordBar.tsx in the same slot above the text (the take goes in
// as a chip, a recording or video not bound to the 20 MB of other files; Send waits while a take records, attaches or
// waits there); Photos & videos takes both; on a phone Take photo and Record video are the camera app's.
// Owns: input handling and when to send (the send itself: composer/send.ts). Never: message rendering or chat settings UI.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ConversationSummary, MessageLevel } from '../../shared/model/chat.ts';
import { Icon } from '../lib/ui.tsx';
import { useContextMenu } from '../lib/context-menu.tsx';
import { chatPartner, chatTitle, memberName } from '../lib/chat-face.tsx';
import { isMobile, preferences } from '../lib/store.ts';
import { bridge, os } from '../lib/platform.ts';
import { toAttachment, uploadFile } from '../lib/files.ts';
import { COMPOSER_BUSY, composerFill, composerFillText } from '../lib/shell-state.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import { ComposerAttachments } from './Attachments.tsx';
import { SecretAttachments } from './SecretAttachments.tsx';
import { ChatSecretBar } from '../settings/SecretRows.tsx';
import { ReplyQuote } from './ReplyQuote.tsx';
import { draftFor, flushDraft, setReply, updateDraft } from './composer/draft.ts';
import { sendDraft } from './composer/send.ts';
import { createTaskFromText, parseSlash, runSlash, sendMenuItems } from './composer/slash.ts';
import { findToken, suggestionsFor, SuggestionList, useSuggestions } from './composer/Suggestions.tsx';
import type { Suggestion } from './composer/Suggestions.tsx';
import { ModelChip } from './composer/ModelChip.tsx';
import { PlusMenu } from './composer/PlusMenu.tsx';
import { useRecordSlot } from './composer/RecordBar.tsx';
import { isMedia, uploadMedia } from './composer/record-take.ts';
import { ScheduleBar } from './composer/ScheduleBar.tsx';
import { leaveScheduleMode, openScheduleMode, scheduleDraft, scheduleModeFor } from './composer/schedule-mode.ts';
import { scheduleSpec } from './composer/schedule-form.ts';
import { useNextRun } from './composer/schedule-next.ts';
import { cancelDictation, clearDraftSpeech, dictateIntoDraft, dictating, retryTake, transcribing } from './composer/voice.ts';
import { MicButton, talkPress, targetOf, useDictationField, waveState } from './composer/MicButton.tsx';
import { afterTake, cancelCountdown, countdowns, isTalkKey, startCountdown, type TakeEnd } from './composer/dictation-send.ts'; // AF-017
import type { PressTracker } from '../feedback/press.ts';
import { DictationWave } from './composer/DictationWave.tsx';
import { mentionsIn, targetAgent } from './composer/target.ts';
import { composerControls } from './composer/controls.ts';
import type { SpanMark } from '../../shared/voice/marks.ts';
import { markAt } from './composer/draft-marks.ts';
import { MarkLayer } from './composer/MarkLayer.tsx';
import { MarkMenu } from './composer/MarkMenu.tsx';
import { escapeStops, stopChat, useChatStop } from './composer/stop.ts';
import type { SendWhileWorking } from '../../shared/model/prompt-queue.ts';
import { preferredMode, queueDraft, queueFor, sendMode, setPreferredMode } from './composer/queue.ts';
import { QueueList } from './composer/QueueList.tsx';
import { SendSplit } from './composer/SendSplit.tsx';
import { AccessModeCell } from './composer/AccessModeCell.tsx'; // AF-013

export function Composer(props: { chat: ConversationSummary }) {
  const { chat } = props;
  const draft = draftFor(chat.id);
  const { text, attachments, level, replyTo, secrets = [], marks } = draft.value;
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [openMark, setOpenMark] = useState<SpanMark | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [uploading, setUploading] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [secretOpen, setSecretOpen] = useState(false);
  const [modelSignal, setModelSignal] = useState(0);
  const mode = scheduleModeFor(chat.id).value; // schedule mode (null = a normal composer)
  const scheduling = mode !== null;
  const suggest = useSuggestions();
  const record = useRecordSlot(chat.id, (files) => void addFiles(files)); // F23: the RecordBar, the camera input
  const isDictating = dictating.value === chat.id;
  const transcribingHere = transcribing.value.has(chat.id); // the stopped take's text is still on its way
  const hasContent = text.trim().length > 0 || attachments.length > 0 || secrets.length > 0;
  const countdown = countdowns.value.get(chat.id); // AF-017: a dictated draft about to go out
  const talk = useRef<PressTracker | null>(null);
  const talkKeyDown = useRef(false);
  // AF-012: runs at work here that the person has not asked to stop (schedule mode keeps its Schedule button); Esc stops them.
  const working = useChatStop(chat, areaRef, !scheduling);

  const setText = (value: string) => updateDraft(chat.id, { text: value });
  useDictationField(chat.id, fieldRef, setCaret); // D13: the caret after a dictated take

  // Auto-grow up to ~40 % of the viewport, then scroll (schedule mode: from a taller minimum, composer.css).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, Math.round(innerHeight * 0.4))}px`;
  }, [text, scheduling]);
  useEffect(() => { if (scheduling) fieldRef.current?.focus(); }, [scheduling]); // opened from a menu: write the message

  useEffect(() => {
    if (!isMobile.value) fieldRef.current?.focus();
    return () => flushDraft(chat.id);
  }, [chat.id]);
  useEffect(() => { if (replyTo) fieldRef.current?.focus(); }, [replyTo]); // Reply on a message: write it here

  // An emptied draft (sent, turned into a task, cleared) was not dictated any more; reads the draft as it
  // is now, so a failed send that gave the speech back with the text keeps it.
  useEffect(() => { if (!draft.peek().text.trim()) clearDraftSpeech(chat.id); }, [chat.id, text]);

  // One-shot fills ("/task " from the palette and the task panel): only into an empty composer; a
  // draft stays as it is – the field takes the focus and a toast says why nothing was inserted.
  useEffect(() => {
    const fill = composerFill.value;
    if (!fill || fill.conversationId !== chat.id) return;
    composerFill.value = null;
    const next = composerFillText(text, fill.text); // never over the person's draft
    if (next === null) pushToast({ title: COMPOSER_BUSY, tone: 'info' }, 4000);
    else setText(next);
    requestAnimationFrame(() => { const field = fieldRef.current; field?.focus({ preventScroll: true }); field?.setSelectionRange(field.value.length, field.value.length); });
  }, [composerFill.value]);

  const token = findToken(text, caret);
  const items = suggestionsFor(chat, token);
  const visibleItems = suggest.dismissed === items.map((item) => item.key).join() ? [] : items;

  const accept = (item: Suggestion) => {
    if (!token) return;
    const next = text.slice(0, token.start) + item.insert + text.slice(caret);
    setText(next);
    const position = token.start + item.insert.length;
    requestAnimationFrame(() => { fieldRef.current?.setSelectionRange(position, position); setCaret(position); });
  };

  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    setUploading((current) => [...current, ...list.map((file) => file.name)]);
    for (const file of list) {
      try {
        const attachment = isMedia(file) ? await uploadMedia(file, file.name, chat.id) // a recording or video: chunked, no 20 MB cap
          : await uploadFile(file, undefined, { conversationId: chat.id }); // F-52: a person's file goes into this chat
        updateDraft(chat.id, { attachments: [...draft.value.attachments, attachment] });
      } catch (error) { toastError(error, 'Upload failed'); }
      setUploading((current) => { const index = current.indexOf(file.name); return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)]; });
    }
  };

  const pickFiles = async (images: boolean) => {
    if (bridge) {
      // Desktop: the native dialog; main uploads the choice by path (no bytes through here).
      try {
        const refs = await bridge.files.pick(images ? 'images' : 'files');
        if (refs.length) updateDraft(chat.id, { attachments: [...draft.value.attachments, ...refs.map(toAttachment)] });
      } catch (error) { toastError(error, 'Upload failed'); }
      return;
    }
    (images ? imageRef : fileRef).current?.click();
  };

  // The whole draft goes out – files, secrets, reply – also at another level (composer/send.ts).
  const sendAs = (body: string, sentLevel: MessageLevel) => sendDraft({ conversationId: chat.id, body, level: sentLevel, mentions: (sent) => mentionsIn(sent, chat) });

  /** `sentLevel`: the Plus menu's "Send as important" / "Send silently" (no slash command then); `how`: AF-016 now, queue or the other one than the default. */
  const send = async (sentLevel?: MessageLevel, how?: SendWhileWorking | 'other') => {
    if (sending || record.held || transcribing.peek().has(chat.id)) return; // never sends without the dictated words or the take
    cancelCountdown(chat.id); // AF-017: sent now, by hand or by the countdown itself
    setSending(true); // also while a dictation is transcribed first (a second tap sends nothing twice)
    try {
      // A take that came back as a recording or failed stays in the draft: the person sees it (and the toast) first.
      if (isDictating && !(await dictateIntoDraft())) return;
      const body = draft.value.text;
      if (!body.trim() && !draft.value.attachments.length && !draft.value.secrets?.length) return;
      const slash = sentLevel ? null : parseSlash(body);
      if (slash) {
        const clear = await runSlash(slash, {
          chat,
          openModelMenu: () => setModelSignal(Date.now()),
          setLevel: (next) => updateDraft(chat.id, { level: next }),
          send: (rest, options) => sendAs(rest, options?.level ?? draft.peek().level),
        });
        if (clear) updateDraft(chat.id, { text: '' }); // a sent command's draft is already fresh (sendDraft)
        return;
      }
      const way = how === 'now' || how === 'queue' ? how
        : sendMode({ busy: (chat.live?.length ?? chat.working.length) > 0, queued: queueFor(chat.id).peek().items.length, other: how === 'other', preferred: preferredMode() });
      if (!sentLevel && way === 'queue') { await queueDraft(chat.id, body, (sent) => mentionsIn(sent, chat)); return; }
      await sendAs(body, sentLevel ?? draft.value.level);
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  /** AF-017: a take ends with ✓ ('done': the preference decides), ➤ or the release of a hold (both send). */
  const finishTake = async (end: TakeEnd) => {
    if (end !== 'done') { await send(); return; }
    if (!(await dictateIntoDraft()) || !draft.peek().text.trim()) return;
    const next = afterTake(end, preferences.peek().dictationSend);
    if (next === 'send') await sendRef.current();
    else if (next === 'countdown') startCountdown(chat.id, () => void sendRef.current());
  };
  const sendRef = useRef(send);
  sendRef.current = send; // the countdown ends two seconds later: it sends the way that holds then
  const finishRef = useRef(finishTake);
  finishRef.current = finishTake; // a press outlives a render (and a switch to another chat)
  const chatRef = useRef(chat.id);
  chatRef.current = chat.id;
  talk.current ??= talkPress(() => chatRef.current, fieldRef, { stop: () => void finishRef.current('done'), send: () => void finishRef.current('release') });

  /** Schedule mode's Send: posts the draft at the settings' time(s) – also at another level (the right-click menu). */
  const scheduleNow = async (sentLevel?: MessageLevel) => {
    if (sending || transcribing.peek().has(chat.id)) return;
    setSending(true);
    try {
      if (isDictating && !(await dictateIntoDraft())) return;
      if (sentLevel) updateDraft(chat.id, { level: sentLevel });
      await scheduleDraft(chat);
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!scheduling && talk.current && isTalkKey(event, os === 'mac')) { // AF-017: the dictation key – tap toggles, hold talks
      event.preventDefault();
      if (!event.repeat && !talkKeyDown.current) { talkKeyDown.current = true; talk.current.down(); }
      return;
    }
    if (openMark) { setOpenMark(null); if (event.key === 'Escape') { event.preventDefault(); return; } } // typing closes the mark menu
    if (event.key === 'Escape' && cancelCountdown(chat.id)) { event.preventDefault(); return; } // AF-017: the words stay
    if (suggest.onKeyDown(event, visibleItems, accept)) { event.preventDefault(); return; }
    if (event.key === 'Escape' && scheduling) { event.preventDefault(); leaveScheduleMode(chat.id); return; }
    if (event.key === 'Escape' && draft.peek().replyTo) { event.preventDefault(); setReply(chat.id, null); return; }
    if (event.key === 'Escape' && working && escapeStops(event)) { event.preventDefault(); void stopChat(chat); return; } // AF-012
    if (event.key !== 'Enter' || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    const enterSends = preferences.value.enterSends && !isMobile.value;
    if ((enterSends && !event.shiftKey && !mod) || (!enterSends && mod && !event.shiftKey)) { event.preventDefault(); void (scheduling ? scheduleNow() : send()); }
    else if (!scheduling && mod && (enterSends ? !event.shiftKey : event.shiftKey)) { event.preventDefault(); void send(undefined, 'other'); } // AF-016
  };

  /** AF-017: the dictation key or one of its modifiers let go ends the press (a hold: the take is sent). */
  const onKeyUp = (event: KeyboardEvent) => {
    setCaret((event.target as HTMLTextAreaElement).selectionStart);
    if (!talkKeyDown.current) return;
    if (event.key === ' ' || event.code === 'Space' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta') {
      talkKeyDown.current = false;
      talk.current?.up();
    }
  };
  const onBlur = () => { if (talkKeyDown.current) { talkKeyDown.current = false; talk.current?.cancel(); } };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length) { event.preventDefault(); void addFiles(files); }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) void addFiles(files);
  };

  const makeTask = async () => {
    const body = draft.value.text.trim();
    if (!body) composerFill.value = { conversationId: chat.id, text: '/task ' }; // an empty field: write the task there
    else if (await createTaskFromText(chat.id, body)) updateDraft(chat.id, { text: '', replyTo: undefined });
  };

  const agentId = targetAgent(text, chat, replyTo);
  const partner = chatPartner(chat);
  const placeholder = `${scheduling ? 'Scheduled message for' : 'Message'} ${(partner && memberName(partner.memberId)) || chatTitle(chat)}`;

  const controls = composerControls({ hasContent, transcribing: transcribingHere, working, dictating: isDictating && !scheduling });
  // A scheduled message is text only: files and secrets in the draft would be left behind, so the mode says so (note)
  const heavy = [attachments.length ? 'files' : '', secrets.length ? 'secrets' : ''].filter(Boolean).join(' and ');
  const note = scheduling && heavy ? `A scheduled message is text only – remove the ${heavy} to schedule it.` : undefined;
  const built = mode ? scheduleSpec(mode.form, Date.now()) : null;
  const next = useNextRun(built && 'spec' in built ? built.spec : null);
  const scheduleReady = !!built && 'spec' in built && !next.error && !note && !!text.trim();
  const sendActions = {
    sendAs: scheduling ? (scheduleReady ? (sentLevel: MessageLevel) => void scheduleNow(sentLevel) : undefined) : hasContent ? (sentLevel: MessageLevel) => void send(sentLevel) : undefined,
    level, setLevel: (next: MessageLevel) => updateDraft(chat.id, { level: next }),
    schedule: () => openScheduleMode(chat.id),
    scheduling,
  };
  const sendMenu = useContextMenu(() => [{ items: sendMenuItems(sendActions) }]);
  // Schedule mode: the same round cell with a clock (a wider label would move the model and the mic)
  const primary = controls.primary === 'stop'
    // AF-012: the same round cell, a square – Send comes back at once after the click (composer/stop.ts)
    ? <button type="button" class="send-button stop-button" aria-label="Stop" title="Stop (Esc)" data-tour="run-stop" onClick={() => void stopChat(chat)}><span class="stop-square" aria-hidden="true" /></button>
    : <button type="button" class="send-button" aria-label={scheduling ? 'Schedule' : 'Send'} title={scheduling ? 'Schedule' : undefined} data-tour="composer-send" {...sendMenu}
    disabled={(scheduling ? !scheduleReady || transcribingHere : controls.primary === 'send-disabled') || sending || uploading.length > 0 || record.held}
    onClick={() => void (scheduling ? scheduleNow() : send())}><Icon name={scheduling ? 'clock' : 'arrow-up'} size={19} /></button>;

  return (
    <div class="composer-area" ref={areaRef}>
      <QueueList conversationId={chat.id} />
      <div data-tour="composer" class={`composer${dragOver ? ' drag-over' : ''}${level === 'important' ? ' important' : ''}${scheduling ? ' scheduling' : ''}`}
        onDragOver={(event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
        <SuggestionList items={visibleItems} active={suggest.active} onPick={accept} onHover={suggest.setActive} />
        {mode && <ScheduleBar conversationId={chat.id} mode={mode} next={next} note={note} onLeave={() => leaveScheduleMode(chat.id)} />}
        {secretOpen && <ChatSecretBar key={chat.id} conversationId={chat.id} room={20 - secrets.length} onLeave={() => { setSecretOpen(false); fieldRef.current?.focus(); }}
          onAttach={(id) => updateDraft(chat.id, { secrets: [...(draft.peek().secrets ?? []), id] })} />}
        {record.bar}
        {replyTo && <ReplyQuote conversationId={chat.id} messageId={replyTo} onCancel={() => { setReply(chat.id, null); fieldRef.current?.focus(); }} />}
        <SecretAttachments ids={secrets} onRemove={id => updateDraft(chat.id, { secrets: secrets.filter(entry => entry !== id) })} />
        <ComposerAttachments attachments={attachments} uploading={uploading} conversationId={chat.id}
          onRetry={(attachment) => retryTake(chat.id, attachment, targetOf(fieldRef.current))}
          onRemove={(fileId) => updateDraft(chat.id, { attachments: draft.value.attachments.filter((entry) => entry.fileId !== fileId) })} />
        <div class="composer-field">
          {marks?.uncertain?.length ? <MarkLayer field={fieldRef} layer={layerRef} text={text} marks={marks.uncertain} /> : null}
          <textarea
            ref={fieldRef}
            class="composer-input"
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            onInput={(event) => { const field = event.target as HTMLTextAreaElement; cancelCountdown(chat.id); setText(field.value); setCaret(field.selectionStart); suggest.dismiss(null); setOpenMark(null); }}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
            onClick={(event) => {
              const field = event.target as HTMLTextAreaElement;
              setCaret(field.selectionStart);
              const index = field.selectionStart === field.selectionEnd ? markAt(draft.peek().marks, field.selectionStart) : -1;
              setOpenMark(index < 0 ? null : draft.peek().marks?.uncertain?.[index] ?? null);
            }}
            onPaste={onPaste}
          />
          {openMark && <MarkMenu key={`${openMark.start}:${openMark.end}`} conversationId={chat.id} field={fieldRef} layer={layerRef} mark={openMark} onClose={() => setOpenMark(null)} onCaret={setCaret} />}
        </div>
        <div class="composer-actions">
          <PlusMenu chat={chat} actions={{
            discardDictation: isDictating ? () => void cancelDictation() : undefined,
            pickFiles: () => void pickFiles(false),
            pickImages: () => void pickFiles(true),
            secret: secrets.length < 20 ? () => setSecretOpen(true) : undefined,
            makeTask: () => void makeTask(),
            ...record.actions,
            ...sendActions,
          }} />
          <AccessModeCell chat={chat} agentId={agentId} />{/* AF-013: the access mode (click / Shift+Tab) */}
          <div class="composer-spacer"><DictationWave state={waveState(chat.id)} /></div>
          {countdown && <button type="button" class="dictation-countdown" title="The dictated message goes out – Cancel keeps it in the field (Esc)"
            onClick={() => { cancelCountdown(chat.id); fieldRef.current?.focus({ preventScroll: true }); }}><span class="dictation-countdown-bar" />Sending · Cancel</button>}
          <ModelChip chat={chat} agentId={agentId} openSignal={modelSignal} />
          <MicButton draftKey={chat.id} field={fieldRef} onStop={() => void (scheduling ? dictateIntoDraft() : finishTake('done'))}
            onHoldSend={scheduling ? undefined : () => void finishTake('release')} tracker={talk.current} />
          {primary}
          <SendSplit actions={{ sendNow: hasContent ? () => void send(undefined, 'now') : undefined, queue: hasContent ? () => void send(undefined, 'queue') : undefined,
            preferred: preferredMode(), setPreferred: (next) => void setPreferredMode(next), enterSends: preferences.value.enterSends && !isMobile.value, scheduling }} />
        </div>
      </div>
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => { const input = event.target as HTMLInputElement; void addFiles([...(input.files ?? [])]); input.value = ''; }} />
      <input ref={imageRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { const input = event.target as HTMLInputElement; void addFiles([...(input.files ?? [])]); input.value = ''; }} />
      {record.input}
    </div>
  );
}
