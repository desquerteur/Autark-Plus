// AF-024: "Google Gemini" in the model setup (ModelSetup.tsx) – one inline panel with a name ("Gemini 2" suggested) and
// the two ways in: "Sign in with Google" (a Google account – the Gemini plan – through Gemini CLI: installed through npm
// when missing, each account in a sign-in folder of its own, so several Google accounts work side by side; the plan flow
// of onboarding/plan-setup.ts with its status line under the buttons) and "API key" (the connection form with Google AI
// Studio picked; the key is billed per use). Every account gets the Gemini logo (lib/account-face.ts) and can be renamed
// in its row.
// Owns: this panel and its texts. Never: types or shows a password or token – the Google sign-in runs in the browser.

import { useState } from 'preact/hooks';
import type { DetectionReport } from '../../shared/model/providers.ts';
import { planFlow, startPlan } from '../onboarding/plan-actions.tsx';
import { accounts } from '../lib/store.ts';
import { Button } from '../lib/ui.tsx';
import { ConnectionForm } from './account-forms.tsx';
import { GEMINI_HINT, nextGeminiName } from './providers.ts';

export function GeminiAdd(props: { report: () => DetectionReport | null; onDone: () => void }) {
  const [name, setName] = useState('');
  const [byKey, setByKey] = useState(false);
  const suggested = nextGeminiName(accounts.value);
  const label = name.trim().slice(0, 80) || suggested;
  if (byKey) return <ConnectionForm kind="api" service="google" label={label} onDone={props.onDone} />;
  const running = planFlow.value.running === 'gemini-cli';
  return (
    <div class="add-account inline-form gemini-add">
      <label class="field-label" for="gemini-add-name">Name</label>
      <input id="gemini-add-name" class="input" autocomplete="off" maxLength={80} placeholder={suggested} value={name}
        onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} />
      <span class="field-label">Connect with</span>
      <div class="gemini-add-ways">
        <Button variant="primary" class="small" busy={running} onClick={() => startPlan('gemini-cli', props.report, label)}>Sign in with Google</Button>
        <Button variant="secondary" class="small" disabled={running} onClick={() => setByKey(true)}>API key</Button>
        <Button variant="ghost" class="small" onClick={props.onDone}>Cancel</Button>
      </div>
      <p class="gemini-add-hint">{GEMINI_HINT}</p>
    </div>
  );
}
