// AF-021: the effort slider's rules – stops (Auto + the model's efforts, the plain levels without a model), where a
// stored effort sits, pointer and keys → stop, and the patch (the same settings.efforts value as the old buttons).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_STEP, PLAIN_EFFORTS, effortSteps, effortsWith, indexAt, keyStep, stepIndex, stopPercent } from '../../../src/ui/chat/composer/effort-slider.ts';

test('stops: Auto first, then only what the model can – never "none"; the plain levels without a model', () => {
  assert.deepEqual(effortSteps(['none', 'low', 'medium', 'high']), [AUTO_STEP, 'low', 'medium', 'high']);
  assert.deepEqual(effortSteps(['max', 'low', 'xhigh', 'high', 'medium']), [AUTO_STEP, 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(effortSteps(undefined), [AUTO_STEP, ...PLAIN_EFFORTS]);
  assert.deepEqual(effortSteps([]), [AUTO_STEP, ...PLAIN_EFFORTS]);
  assert.deepEqual(effortSteps(['none']), [AUTO_STEP, ...PLAIN_EFFORTS]);
});

test('a stored effort: Auto when none, its own stop, else the nearest the model offers', () => {
  const steps = effortSteps(['low', 'medium', 'high']);
  assert.equal(stepIndex(steps, undefined), 0);
  assert.equal(stepIndex(steps, 'auto'), 0);
  assert.equal(stepIndex(steps, 'medium'), 2);
  assert.equal(stepIndex(steps, 'max'), 3, 'max on a model up to high → high');
  assert.equal(stepIndex(steps, 'xhigh'), 3);
  assert.equal(stepIndex(steps, 'none'), 1, 'none → the lowest stop');
  assert.equal(stepIndex(steps, 'garbage'), 0);
});

test('pointer: the cell under it, clamped to the track', () => {
  assert.equal(indexAt(0, 0, 250, 5), 0);
  assert.equal(indexAt(49, 0, 250, 5), 0);
  assert.equal(indexAt(50, 0, 250, 5), 1);
  assert.equal(indexAt(249, 0, 250, 5), 4);
  assert.equal(indexAt(-30, 0, 250, 5), 0);
  assert.equal(indexAt(900, 0, 250, 5), 4);
  assert.equal(indexAt(100, 0, 0, 5), 0, 'no width yet');
  assert.equal(stopPercent(0, 5), 10);
  assert.equal(stopPercent(4, 5), 90);
});

test('keys: arrows step, Home/End jump, other keys are not the slider\'s', () => {
  assert.equal(keyStep('ArrowRight', 1, 5), 2);
  assert.equal(keyStep('ArrowUp', 4, 5), 4, 'stays at the end');
  assert.equal(keyStep('ArrowLeft', 0, 5), 0, 'stays at Auto');
  assert.equal(keyStep('ArrowDown', 3, 5), 2);
  assert.equal(keyStep('Home', 3, 5), 0);
  assert.equal(keyStep('End', 0, 5), 4);
  assert.equal(keyStep('PageUp', 2, 5), 3);
  assert.equal(keyStep('Enter', 2, 5), undefined);
  assert.equal(keyStep('a', 2, 5), undefined);
});

test('the patch: the effort for the agent, Auto removes its key, others stay', () => {
  assert.deepEqual(effortsWith({ ag_b: 'low' }, 'ag_a', 'high'), { ag_b: 'low', ag_a: 'high' });
  assert.deepEqual(effortsWith({ ag_a: 'high', ag_b: 'low' }, 'ag_a', AUTO_STEP), { ag_b: 'low' });
  assert.deepEqual(effortsWith(undefined, 'ag_a', AUTO_STEP), {});
});
