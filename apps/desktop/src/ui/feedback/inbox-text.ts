// The team inbox's words (FeedbackInbox.tsx): a mark and the day it removes the report, one report's meta line and
// one fetch's result line. Feedback 16.11.2026: the meta line says the PC's version "via PC" when the report names
// where it was written (that `client` line stands under it), the sending company's data folder (two same-named
// companies told apart), "dictated" (read it for what was meant) and a kind only for an agent's report; a fetch that
// left letters in the mailbox says so – with their number when the runtime counted them.
// Owns: these texts. Never: renders or fetches anything.

import { FEEDBACK_HANDLED_KEEP_MS, reportNumber } from '../../shared/model/feedback-delivery.ts';
import type { FeedbackHandled, FeedbackInboxFetch, FeedbackInboxItem } from '../../shared/model/feedback-delivery.ts';

export const HANDLED_LABEL: Record<FeedbackHandled, string> = { done: 'Done', irrelevant: 'Not relevant' };

/** "Done · goes 23 Nov" – the mark and the day the runtime removes the report. */
export function handledText(handled: NonNullable<FeedbackInboxItem['handled']>): string {
  return `${HANDLED_LABEL[handled.as]} · goes ${new Date(handled.at + FEEDBACK_HANDLED_KEEP_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** "No. C0FD8641 · 16.11.2026, 07:49 · via PC 0.3.9 · win32 … · company-2 · dictated · Done · goes 23 Nov". */
export function metaLine(item: FeedbackInboxItem): string {
  const parts = [
    `No. ${reportNumber(item.id)}`,
    new Date(item.createdAt).toLocaleString(),
    `${item.client ? 'via PC ' : ''}${item.appVersion}`,
    item.os,
    item.company,
    item.dictated ? 'dictated' : undefined,
    item.fromAgent ? `Agent report${item.kind ? ` (${item.kind})` : ''}` : undefined,
    item.handled ? handledText(item.handled) : undefined,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** One fetch: the total, letters this PC cannot open, and – a flood – that more wait (`waiting`: how many, when counted). */
export function fetchText(result: FeedbackInboxFetch & { waiting?: number }): string {
  const unreadable = result.unreadable ? ` ${result.unreadable} could not be opened.` : '';
  const counted = typeof result.waiting === 'number' && result.waiting > 0 ? `${result.waiting} more waiting` : 'More waiting';
  return `${result.total} reports.${unreadable}${result.more ? ` ${counted} – Refresh takes the next.` : ''}`;
}
