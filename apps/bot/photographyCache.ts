/**
 * Short-TTL in-memory cache for the two hot photography sheet reads:
 * `readProgress` (Photography Progress tab) and `getActiveAssignment`
 * (Photography Assignments tab).
 *
 * Why: every photography agent message + several slash-command handlers
 * (/skills, /next, /active, /learn …) call these. Each is a 200-500ms
 * Google Sheets round-trip; back-to-back queries from the same chat
 * session hammer them. A 10s TTL covers the typical "rapid message
 * exchange" pattern without much staleness risk, and writes invalidate
 * to keep the agent in sync after /start, /skip, photo submissions, etc.
 *
 * Single instance per bot process — shared by both the photography
 * agent's `toolDeps` and the slash-command `handlerDeps.photography`.
 */

import type { ProgressRow, AssignmentRow } from '../../lib/photographySheets.js';

const DEFAULT_TTL_MS = 10 * 1000;

export interface PhotographyCacheOptions {
  /** Source of truth — actual Google Sheets readers. */
  readProgress: () => Promise<ProgressRow[]>;
  getActiveAssignment: () => Promise<AssignmentRow | null>;
  /** TTL override (default 10s). */
  ttlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export class PhotographyReadCache {
  private progressPromise: Promise<ProgressRow[]> | null = null;
  private progressAt = 0;
  private activePromise: Promise<AssignmentRow | null> | null = null;
  private activeAt = 0;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: PhotographyCacheOptions) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async readProgress(): Promise<ProgressRow[]> {
    if (this.progressPromise !== null && this.now() - this.progressAt < this.ttlMs) {
      return this.progressPromise;
    }
    this.progressAt = this.now();
    this.progressPromise = this.opts.readProgress();
    // Drop the promise from cache if it rejects so the next call re-fetches.
    this.progressPromise.catch(() => {
      this.progressPromise = null;
      this.progressAt = 0;
    });
    return this.progressPromise;
  }

  async getActiveAssignment(): Promise<AssignmentRow | null> {
    if (this.activePromise !== null && this.now() - this.activeAt < this.ttlMs) {
      return this.activePromise;
    }
    this.activeAt = this.now();
    this.activePromise = this.opts.getActiveAssignment();
    this.activePromise.catch(() => {
      this.activePromise = null;
      this.activeAt = 0;
    });
    return this.activePromise;
  }

  /**
   * Invalidate both cached reads. Call after any write to Photography
   * Progress or Photography Assignments tabs — `upsertProgress`,
   * `appendAssignment`, `updateAssignment`.
   */
  invalidate(): void {
    this.progressPromise = null;
    this.progressAt = 0;
    this.activePromise = null;
    this.activeAt = 0;
  }
}
