// AF-023: Settings › Models, under the Work and Decisions rows – "If used up": the use's fallback order. Each step shows
// account and model with Up / Down / Remove; under the list an account select, a model select ("Same model" or one of
// its models) and Add. Empty = "Automatic". Logic and texts in fallback-order.ts; the runtime follows the same order
// for the model menu's chosen account (AF-021) – runtime/routing/account-fallback.ts.
// Owns: the row. Never: decides what runs or words a step (fallback-order.ts).

import { useState } from 'preact/hooks';
import { fallbackOrder, type FallbackUse } from '../../shared/model/account-fallback.ts';
import { USE_LABELS } from '../../shared/model/models-uses.ts';
import { IconButton } from '../lib/ui.tsx';
import { can } from '../lib/session.ts';
import { accounts, models, settings, updateSettings, usage } from '../lib/store.ts';
import { act, ActionButton, Row, Select } from './controls.tsx';
import { accountChoices, modelChoices, moved, orderHint, orderPatch, SAME_MODEL, stepViews, without, withStep } from './fallback-order.ts';

export function FallbackOrder(props: { use: FallbackUse }) {
  const { use } = props;
  const order = fallbackOrder(settings.value?.routing.fallbacks, use);
  const steps = stepViews(order, accounts.value, models.value, usage.value);
  const choices = accountChoices(use, accounts.value, models.value, usage.value);
  const [account, setAccount] = useState('');
  const [model, setModel] = useState(SAME_MODEL);
  const picked = choices.some((choice) => choice.value === account) ? account : choices[0]?.value ?? '';
  const modelList = picked ? modelChoices(use, picked, accounts.value, models.value) : [];
  const pickedModel = modelList.some((choice) => choice.value === model) ? model : SAME_MODEL;
  const locked = !can('settings.update');
  const save = (next: typeof order) => void act(() => updateSettings(orderPatch(use, next)), 'Could not save');
  const name = USE_LABELS[use];
  return (
    <Row class="use-row fallback-row" stack label={<span class="fallback-title">If used up</span>} hint={orderHint(order)}>
      <div class="fallback-order">
        {steps.length > 0 && (
          <ol class="fallback-steps" aria-label={`${name}: fallback order`}>
            {steps.map((step, index) => (
              <li key={step.key} class={`fallback-step${step.missing ? ' missing' : ''}`}>
                <span class="fallback-step-rank" aria-hidden="true">{index + 1}</span>
                <span class="fallback-step-label" title={step.missing ? `${step.label} – skipped while it is gone or off` : step.label}>{step.label}</span>
                <IconButton icon="arrow-up" size="small" label={`Move ${step.label} up`} disabled={locked || index === 0} onClick={() => save(moved(order, index, -1))} />
                <IconButton icon="arrow-down" size="small" label={`Move ${step.label} down`} disabled={locked || index === steps.length - 1} onClick={() => save(moved(order, index, 1))} />
                <IconButton icon="x" size="small" label={`Remove ${step.label}`} disabled={locked} onClick={() => save(without(order, index))} />
              </li>
            ))}
          </ol>
        )}
        <div class="fallback-add">
          <Select label={`${name}: fallback account`} value={picked} options={choices.length ? choices : [{ value: '', label: 'No account' }]} disabled={locked || !choices.length}
            onChange={(value) => { setAccount(value); setModel(SAME_MODEL); }} />
          <Select label={`${name}: fallback model`} value={pickedModel} options={modelList.length ? modelList : [{ value: SAME_MODEL, label: 'Same model' }]} disabled={locked || !picked}
            onChange={setModel} />
          <ActionButton label="Add" disabled={locked || !picked || withStep(order, picked, pickedModel).length === order.length} onClick={() => save(withStep(order, picked, pickedModel))} />
          {order.length > 0 && <ActionButton label="Automatic" variant="ghost" disabled={locked} onClick={() => save([])} />}
        </div>
      </div>
    </Row>
  );
}
