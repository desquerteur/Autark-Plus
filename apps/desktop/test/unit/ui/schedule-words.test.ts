// #20: plain words → the schedule form (English and German), and what is left as the instructions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScheduleWords } from '../../../src/ui/schedules/schedule-words.ts';
import { defaultForm, scheduleSpec } from '../../../src/ui/chat/composer/schedule-form.ts';

// Thursday 19 Nov 2026, 13:00 in Berlin
const NOW = Date.UTC(2026, 10, 19, 12, 0);
const base = defaultForm(NOW, 'Europe/Berlin');
const read = (text: string) => readScheduleWords(text, base, NOW);

test('every day / täglich at a time', () => {
  for (const text of ['every day at 6 research the news', 'täglich um 6 Uhr research the news', 'daily 06:00 research the news', 'jeden Tag um 6 research the news']) {
    const got = read(text);
    assert.deepEqual(got?.form, { kind: 'repeat', repeat: 'days', days: [0, 1, 2, 3, 4, 5, 6], clock: '06:00' }, text);
    assert.equal(got?.rest, 'research the news', text);
  }
});

test('weekdays, weekends, ranges and lists of days', () => {
  assert.deepEqual(read('every weekday at 7:30 summarise the news')?.form.days, [1, 2, 3, 4, 5]);
  assert.equal(read('every weekday at 7:30 summarise the news')?.form.clock, '07:30');
  assert.equal(read('every weekday at 7:30 summarise the news')?.rest, 'summarise the news');
  assert.deepEqual(read('werktags um 8 Mails prüfen')?.form.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(read('Mo-Fr 18:00 Tagesbericht')?.form, { kind: 'repeat', repeat: 'days', days: [1, 2, 3, 4, 5], clock: '18:00' });
  assert.deepEqual(read('montags bis freitags um 9')?.form.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(read('mondays and fridays at 6pm water the plants')?.form, { kind: 'repeat', repeat: 'days', days: [1, 5], clock: '18:00' });
  assert.equal(read('mondays and fridays at 6pm water the plants')?.rest, 'water the plants');
  assert.deepEqual(read('on weekends at 10 plan the week')?.form.days, [0, 6]);
  assert.deepEqual(read('every sunday evening review the week')?.form, { kind: 'repeat', repeat: 'days', days: [0], clock: '19:00' });
});

test('intervals', () => {
  assert.deepEqual(read('every 30 minutes check the build')?.form, { kind: 'repeat', repeat: 'every', every: '30', unit: 'minutes' });
  assert.equal(read('every 30 minutes check the build')?.rest, 'check the build');
  assert.deepEqual(read('alle 2 Stunden Server prüfen')?.form, { kind: 'repeat', repeat: 'every', every: '2', unit: 'hours' });
  assert.deepEqual(read('hourly')?.form, { kind: 'repeat', repeat: 'every', every: '1', unit: 'hours' });
  assert.deepEqual(read('every other day at 9 backup')?.form, { kind: 'repeat', repeat: 'every', every: '2', unit: 'days', start: '2026-11-20T09:00' });
});

test('once: tomorrow, today, in N, a date, a weekday, a bare time', () => {
  assert.deepEqual(read('tomorrow at 9 call the dentist')?.form, { kind: 'once', date: '2026-11-20', time: '09:00' });
  assert.equal(read('tomorrow at 9 call the dentist')?.rest, 'call the dentist');
  assert.deepEqual(read('morgen um 14:30 Zahnarzt')?.form, { kind: 'once', date: '2026-11-20', time: '14:30' });
  assert.deepEqual(read('übermorgen früh')?.form, { kind: 'once', date: '2026-11-21', time: '08:00' });
  assert.deepEqual(read('heute abend um 8 Müll rausbringen')?.form, { kind: 'once', date: '2026-11-19', time: '20:00' });
  assert.equal(read('heute abend um 8 Müll rausbringen')?.rest, 'Müll rausbringen');
  assert.deepEqual(read('in 2 hours stretch')?.form, { kind: 'once', date: '2026-11-19', time: '15:00' });
  assert.deepEqual(read('in drei Tagen um 10')?.form, { kind: 'once', date: '2026-11-22', time: '10:00' });
  assert.deepEqual(read('am 24.12. um 18 Uhr Bescherung')?.form, { kind: 'once', date: '2026-12-24', time: '18:00' });
  assert.deepEqual(read('on 3.1. at 9')?.form, { kind: 'once', date: '2027-01-03', time: '09:00' }, 'a passed day-month is next year');
  assert.deepEqual(read('on monday at 9 send the report')?.form, { kind: 'once', date: '2026-11-23', time: '09:00' });
  assert.deepEqual(read('at 11 coffee')?.form, { kind: 'once', date: '2026-11-20', time: '11:00' }, '11:00 has passed today');
  assert.deepEqual(read('at 17 coffee')?.form, { kind: 'once', date: '2026-11-19', time: '17:00' });
});

test('words without a time are left alone; numbers that are not times are not read as times', () => {
  assert.equal(read('write a short summary of the news'), undefined);
  assert.equal(read('do the dishes'), undefined, '"do" is not Thursday');
  assert.equal(read('pick the 5 most important stories'), undefined);
});

test('what it reads makes a valid schedule', () => {
  for (const text of ['every weekday at 7:30', 'alle 15 min', 'tomorrow at 9', 'every other day at 9', 'Mo-Fr 18:00', 'in 2 hours']) {
    const got = read(text);
    assert.ok(got, text);
    const built = scheduleSpec({ ...base, ...got.form }, NOW);
    assert.ok('spec' in built, `${text}: ${'error' in built ? built.error : ''}`);
  }
});

test('a day of the month becomes a cron rule: "every month on the 1st", "monatlich am 15. um 8"; without a day the 1st', () => {
  assert.deepEqual(read('every month on the 1st pay rent'), { form: { kind: 'repeat', repeat: 'cron', cron: '0 9 1 * *' }, rest: 'pay rent' });
  assert.deepEqual(read('monthly on the 15th at 9:30am invoices'), { form: { kind: 'repeat', repeat: 'cron', cron: '30 9 15 * *' }, rest: 'invoices' });
  assert.deepEqual(read('jeden Monat am 15. um 8 Uhr Bericht'), { form: { kind: 'repeat', repeat: 'cron', cron: '0 8 15 * *' }, rest: 'Bericht' });
  assert.deepEqual(read('monatlich Miete zahlen'), { form: { kind: 'repeat', repeat: 'cron', cron: '0 9 1 * *' }, rest: 'Miete zahlen' });
  const words = read('every month on the 1st pay rent')!;
  const spec = scheduleSpec({ ...base, ...words.form }, NOW);
  assert.ok('spec' in spec, 'the cron rule is a valid schedule');
});
