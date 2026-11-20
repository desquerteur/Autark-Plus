// AF-017 (desquerteur/Autark-Plus#18): what follows a finished dictation in the chat composer – settings.json
// preferences.dictationSend. 'off' (default): the words stay in the field; 'on': they are sent at once; 'countdown':
// they are sent after a short countdown the person can cancel. ➤ during a take and the release of a held mic send
// whatever this says. "Send" is the composer's own send, so while an agent works it follows preferences.whileWorking.
// Owns: the preference's type. Never: the decision itself (ui/chat/composer/dictation-send.ts).

export type DictationSend = 'off' | 'on' | 'countdown';

declare module './system.ts' {
  interface Preferences {
    /** AF-017: after a dictation the words stay in the field ('off', absent), are sent ('on') or sent after 2 s ('countdown'). */
    dictationSend?: DictationSend;
  }
}
