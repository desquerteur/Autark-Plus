// Repository for `feedback` (reports to the developers).
// Owns: SQL and row↔model mapping. A report's repeat `count` and (16.11.2026) its recorded takes' `audioFileIds` are
// kept in the `context` JSON column (no schema change); the model has them top-level. A report without a kind (a
// person's, 16.11.2026) is stored with kind ''.
// Never: sending reports, deduplicating or rate limiting (FeedbackService).

import { json, toJson, type Db, type Row } from '../db/database.ts';
import type { FeedbackReport } from '../../shared/model/system.ts';
import { compact, nul, opt, optNumber } from './rows.ts';

type StoredContext = FeedbackReport['context'] & { count?: number; receiptId?: string; visibility?: FeedbackReport['visibility']; deliveryWarning?: string; audioFileIds?: string[] };

function toFeedback(row: Row): FeedbackReport {
  const { count, receiptId, visibility, deliveryWarning, audioFileIds, ...context } = json<StoredContext>(row.context, { version: '', os: '' });
  return compact({
    id: String(row.id),
    kind: row.kind ? row.kind as FeedbackReport['kind'] : undefined,
    text: String(row.text),
    author: String(row.author),
    screenshotFileId: opt<string>(row.screenshot_file_id),
    annotationFileId: opt<string>(row.annotation_file_id),
    audioFileIds: Array.isArray(audioFileIds) && audioFileIds.length ? audioFileIds : undefined,
    context,
    count: typeof count === 'number' && count > 1 ? count : undefined,
    receiptId,
    visibility,
    deliveryWarning,
    status: row.status === 'sent' && !receiptId && String(row.url ?? '').includes('/issues/new?') ? 'queued' : row.status as FeedbackReport['status'],
    url: opt<string>(row.url),
    createdAt: Number(row.created_at),
    sentAt: optNumber(row.sent_at),
  });
}

function storedContext(report: FeedbackReport): StoredContext {
  return {
    ...report.context, ...(report.count && report.count > 1 ? { count: report.count } : {}),
    ...(report.audioFileIds?.length ? { audioFileIds: report.audioFileIds } : {}),
    ...(report.receiptId ? { receiptId: report.receiptId, visibility: report.visibility, deliveryWarning: report.deliveryWarning } : {}),
  };
}

export class FeedbackRepo {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  get(id: string): FeedbackReport | undefined {
    const row = this.db.get('SELECT * FROM feedback WHERE id = ?', [id]);
    return row ? toFeedback(row) : undefined;
  }

  list(limit = 100): FeedbackReport[] {
    return this.db.all('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?', [limit]).map(toFeedback);
  }

  /** Reports by one author created at or after `since`, newest first (dedupe and daily cap). */
  byAuthorSince(author: string, since: number, limit = 100): FeedbackReport[] {
    return this.db.all('SELECT * FROM feedback WHERE author = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?', [author, since, limit]).map(toFeedback);
  }

  /** 16.11.2026: the report one author filed under the writing device's `clientId` (feedback.create dedupe). */
  byClientId(author: string, clientId: string): FeedbackReport | undefined {
    const row = this.db.get("SELECT * FROM feedback WHERE author = ? AND json_extract(context, '$.clientId') = ? LIMIT 1", [author, clientId]);
    return row ? toFeedback(row) : undefined;
  }

  /** One author's reports in `status`, oldest first (the resend of reports that are still to go). */
  byStatus(author: string, status: FeedbackReport['status'], limit = 50): FeedbackReport[] {
    return this.db.all('SELECT * FROM feedback WHERE author = ? AND status = ? ORDER BY created_at ASC LIMIT ?', [author, status, limit]).map(toFeedback);
  }

  save(report: FeedbackReport): void {
    this.db.run(
      `INSERT INTO feedback (id, kind, text, author, screenshot_file_id, annotation_file_id, context, status, url, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, screenshot_file_id = excluded.screenshot_file_id,
         annotation_file_id = excluded.annotation_file_id, context = excluded.context, status = excluded.status,
         url = excluded.url, sent_at = excluded.sent_at`,
      [
        report.id, report.kind ?? '', report.text, report.author, nul(report.screenshotFileId), nul(report.annotationFileId),
        toJson(storedContext(report)), report.status, nul(report.url), report.createdAt, nul(report.sentAt),
      ],
    );
  }
}
