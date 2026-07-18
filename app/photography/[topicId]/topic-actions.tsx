'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../../components/modal';
import { Markdown } from '../../components/markdown';
import { VERDICT_LABELS, sortCriteriaPassFirst } from '../../lib/photography-verdicts';
import { BookOpenIcon, PlayIcon, UploadIcon, SkipForwardIcon, LockIcon, CheckIcon } from '../../components/icons';
import { PerCriterionList } from '../../components/per-criterion-list';

type Mode = 'closed' | 'learn' | 'start' | 'submit' | 'skip';

interface RubricCriterion {
  criterion: string;
  description: string;
  is_core: boolean;
}

interface StartResponse {
  assignmentId: string;
  topicId: string;
  topicName: string;
  assignmentText: string;
  rubric: RubricCriterion[];
}

interface GradeResponse {
  topicId: string;
  topicName: string;
  verdict: 'pass' | 'did_not_pass';
  overallCritique: string;
  suggestedNextStep: string;
  perCriterion: Array<{ criterion: string; result: 'pass' | 'partial' | 'fail'; reason: string }>;
}

interface ErrorState {
  headline: string;
  technical: string;
  code?: string | undefined;
}

const LEARN_TIMEOUT_MS = 45_000;
const START_TIMEOUT_MS = 45_000;
const SKIP_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 90_000; // vision grading is the slowest call in the app

const MAX_SUBMIT_BYTES = 20 * 1024 * 1024; // matches api/photography/submit's cap
const ACCEPTED_MIME_RE = /^image\/(jpeg|png|webp|gif)$/i;
const ACCEPTED_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
const ARW_RE = /image\/x-(sony-)?arw|image\/arw|\.arw$/i;

/**
 * Thrown for any non-ok API response so every catch block can build error
 * copy from a single {status, code} shape instead of re-deriving it inline.
 */
class ApiError extends Error {
  status: number;
  code?: string | undefined;
  constructor(status: number, code?: string) {
    super(code ?? `http_${status}`);
    this.status = status;
    this.code = code;
  }
}

/** Distinguishes a user-initiated Cancel from a client-side submit timeout — both abort the same fetch. */
class UserCancelled extends Error {
  override name = 'UserCancelled';
}
class SubmitTimeout extends Error {
  override name = 'SubmitTimeout';
}

async function throwIfNotOk(r: Response): Promise<void> {
  if (r.ok) return;
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(r.status, body.error);
}

// Plain-language copy per error code, mirrored from app/api/photography/*/route.ts.
const ERROR_COPY: Record<string, string> = {
  invalid_json: 'That request got garbled on the way out. Try again.',
  invalid_multipart: 'That upload didn’t come through correctly. Pick the photo again and resubmit.',
  missing_topicId: 'That request got garbled on the way out. Try again.',
  missing_image: 'Pick a photo before submitting.',
  empty_image: 'That file looks empty — pick a different photo.',
  image_too_large: 'That photo is too large (20MB max). Export a smaller version and try again.',
  arw_rejected: 'RAW (.ARW) files aren’t supported yet — export a JPEG, PNG, WebP, or GIF and try again.',
  unsupported_mime: 'That file type isn’t supported — use JPEG, PNG, WebP, or GIF.',
  unknown_topic: 'This topic couldn’t be found — it may have been renamed. Go back to the Skills page.',
  no_active_assignment: 'This assignment isn’t active anymore — it may already have been graded or skipped elsewhere.',
  corrupted_rubric: 'The saved rubric for this assignment is corrupted and can’t be graded.',
  grader_failed: 'Grading failed on our end — the vision model didn’t return a usable result. Your photo and caption are still here.',
  expander_failed: 'Generating this didn’t work on our end. Try again in a moment.',
};

function messageForStatus(status: number): string {
  if (status === 429) return 'Too many requests right now — wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our end. Try again in a moment.';
  if (status >= 400) return 'That request couldn’t be completed. Try again.';
  return 'Something went wrong. Try again.';
}

function describeError(e: unknown): ErrorState {
  if (e instanceof ApiError) {
    return {
      headline: ERROR_COPY[e.code ?? ''] ?? messageForStatus(e.status),
      technical: `${e.code ?? 'no error code'} (HTTP ${e.status})`,
      code: e.code,
    };
  }
  if (e instanceof SubmitTimeout || (e instanceof DOMException && e.name === 'TimeoutError')) {
    return {
      headline: 'That took too long and timed out. Try again.',
      technical: 'client-side timeout',
      code: 'timeout',
    };
  }
  if (e instanceof TypeError) {
    return {
      headline: 'Couldn’t reach the server — check your connection and try again.',
      technical: e.message,
      code: 'network_error',
    };
  }
  if (e instanceof Error) {
    return { headline: 'Something went wrong. Try again.', technical: e.message };
  }
  return { headline: 'Something went wrong. Try again.', technical: 'unknown_error' };
}

/** Client-side mirror of the checks in api/photography/submit/route.ts, run before upload. */
function validateSubmitFile(file: File): string | null {
  if (ARW_RE.test(file.type) || ARW_RE.test(file.name)) {
    return ERROR_COPY.arw_rejected!;
  }
  const looksAccepted = file.type ? ACCEPTED_MIME_RE.test(file.type) : ACCEPTED_EXT_RE.test(file.name);
  if (!looksAccepted) {
    return ERROR_COPY.unsupported_mime!;
  }
  if (file.size === 0) {
    return ERROR_COPY.empty_image!;
  }
  if (file.size > MAX_SUBMIT_BYTES) {
    return `That photo is ${(file.size / (1024 * 1024)).toFixed(1)}MB — 20MB max. Export a smaller version and try again.`;
  }
  return null;
}

/**
 * Action bar for the topic detail page. Owns modal state for the in-app Learn /
 * Start / Submit / Skip flows. The server component above us has already
 * decided which buttons are enabled (prereqs met, active assignment exists),
 * so we just dispatch.
 */
export function TopicActions({
  topicId,
  topicName,
  hasActiveAssignment,
  prereqsMet,
  activeAssignmentText,
  activeAssignmentRubricJson,
}: {
  topicId: string;
  topicName: string;
  hasActiveAssignment: boolean;
  prereqsMet: boolean;
  /** When hasActiveAssignment, the existing assignment text (so Submit can re-show it). */
  activeAssignmentText?: string;
  activeAssignmentRubricJson?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('closed');

  // Cached results so reopening the modal after a finished action shows the result.
  const [learnText, setLearnText] = useState<string | null>(null);
  const [startResult, setStartResult] = useState<StartResponse | null>(null);
  const [gradeResult, setGradeResult] = useState<GradeResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  function closeAll() {
    setMode('closed');
    setError(null);
  }

  async function runLearn(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/photography/learn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId }),
        signal: AbortSignal.timeout(LEARN_TIMEOUT_MS),
      });
      await throwIfNotOk(r);
      const data = (await r.json()) as { lesson: string };
      setLearnText(data.lesson);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  async function onLearnClick(): Promise<void> {
    setMode('learn');
    setError(null);
    if (learnText) return; // re-open cached
    await runLearn();
  }

  async function runStart(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/photography/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId }),
        signal: AbortSignal.timeout(START_TIMEOUT_MS),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; activeTopicName?: string };
        if (body.error === 'active_assignment_exists') {
          setError({
            headline: `You already have an active assignment on ${body.activeTopicName ?? 'another topic'}. Skip it to start a new one.`,
            technical: 'active_assignment_exists (HTTP 409)',
            code: 'active_assignment_exists',
          });
          return;
        }
        throw new ApiError(r.status, body.error);
      }
      const data = (await r.json()) as StartResponse;
      setStartResult(data);
      // Refresh server data (assignment-history section etc.) once the modal closes.
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  async function onStartClick(): Promise<void> {
    setMode('start');
    setError(null);
    if (startResult) return;
    // If an active assignment already exists for this topic, surface it
    // without calling the API (which would 409). The server passed the text
    // and rubric down for exactly this case.
    if (hasActiveAssignment && activeAssignmentText && activeAssignmentRubricJson) {
      try {
        setStartResult({
          assignmentId: '',
          topicId,
          topicName,
          assignmentText: activeAssignmentText,
          rubric: JSON.parse(activeAssignmentRubricJson) as RubricCriterion[],
        });
      } catch {
        setError({
          headline: ERROR_COPY.corrupted_rubric!,
          technical: 'JSON.parse failed on activeAssignmentRubricJson',
          code: 'corrupted_rubric',
        });
      }
      return;
    }
    await runStart();
  }

  async function onSkipConfirm(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/photography/skip', {
        method: 'POST',
        signal: AbortSignal.timeout(SKIP_TIMEOUT_MS),
      });
      await throwIfNotOk(r);
      setMode('closed');
      // Clear cached state so reopening Start later kicks off a fresh expansion.
      setStartResult(null);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  function openSubmitFromStart(): void {
    setMode('submit');
    setError(null);
  }

  const startErrorIsSkippable = error?.code === 'corrupted_rubric' || error?.code === 'active_assignment_exists';
  const skipErrorIsStale = error?.code === 'no_active_assignment';

  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLearnClick}
          className="inline-flex items-center gap-1.5 rounded-input bg-bg-surface border border-border-subtle px-3 py-2 text-[13px] text-text-primary hover:bg-chip-active"
        >
          <BookOpenIcon size={15} /> Read theory
        </button>
        {hasActiveAssignment ? (
          <>
            <button
              type="button"
              onClick={onStartClick}
              className="inline-flex items-center gap-1.5 rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
            >
              <UploadIcon size={15} /> Submit photo
            </button>
            <button
              type="button"
              onClick={() => setMode('skip')}
              className="inline-flex items-center gap-1.5 rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:bg-chip-active hover:text-text-primary"
              title="Skip the active assignment for this topic"
            >
              <SkipForwardIcon size={15} /> Skip assignment
            </button>
          </>
        ) : prereqsMet ? (
          <button
            type="button"
            onClick={onStartClick}
            className="inline-flex items-center gap-1.5 rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
          >
            <PlayIcon size={15} /> Start assignment
          </button>
        ) : (
          <div className="inline-flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-input border border-dashed border-border-subtle px-3 py-2 text-[13px] text-text-muted"
            >
              <LockIcon size={15} /> Start assignment
            </button>
            <span className="text-[12px] text-text-muted">Prereqs not yet completed</span>
          </div>
        )}
      </div>

      {/* Learn modal */}
      <Modal open={mode === 'learn'} onClose={closeAll} title={`Theory — ${topicName}`} maxWidthClass="max-w-3xl">
        {loading && <LoadingBlock label="Expanding lesson…" />}
        {error && <ErrorBlock error={error} onRetry={runLearn} retryLabel="Try again" />}
        {!loading && !error && learnText && <Markdown text={learnText} />}
      </Modal>

      {/* Start / current-assignment modal */}
      <Modal open={mode === 'start'} onClose={closeAll} title={`Assignment — ${topicName}`} maxWidthClass="max-w-3xl">
        {loading && <LoadingBlock label="Generating assignment…" />}
        {error && (
          <ErrorBlock
            error={error}
            onRetry={startErrorIsSkippable ? () => setMode('skip') : runStart}
            retryLabel={startErrorIsSkippable ? 'Skip assignment' : 'Try again'}
          />
        )}
        {!loading && !error && startResult && (
          <>
            <section className="mb-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Assignment</div>
              <Markdown text={startResult.assignmentText} />
            </section>
            <section className="mb-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                Rubric ({startResult.rubric.length})
              </div>
              <ul className="space-y-1.5">
                {startResult.rubric.map((c) => (
                  <li key={c.criterion} className="rounded-input border border-border-subtle bg-bg-base p-2 text-[12px]">
                    <div className="font-semibold text-text-primary">
                      {c.criterion}
                      {c.is_core && <span className="ml-2 rounded-chip bg-accent-gradient px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-primary">core</span>}
                    </div>
                    {c.description && <div className="text-text-secondary">{c.description}</div>}
                  </li>
                ))}
              </ul>
            </section>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openSubmitFromStart}
                className="inline-flex items-center gap-1.5 rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
              >
                <UploadIcon size={15} /> Submit photo
              </button>
              <button
                type="button"
                onClick={closeAll}
                className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary"
              >
                Close
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Submit photo modal */}
      <SubmitModal
        open={mode === 'submit'}
        onClose={closeAll}
        onSkipInstead={() => setMode('skip')}
        topicName={topicName}
        onGraded={(g) => {
          setGradeResult(g);
          router.refresh();
        }}
        onRetrySubmission={() => setGradeResult(null)}
        result={gradeResult}
      />

      {/* Skip confirm modal */}
      <Modal open={mode === 'skip'} onClose={closeAll} title="Skip assignment?" maxWidthClass="max-w-md">
        <p className="text-[13px] text-text-secondary">
          Skips your active assignment on this topic. The topic stays available — start it again anytime from this page.
        </p>
        {error && (
          <div className="mt-3">
            <ErrorBlock
              error={error}
              onRetry={skipErrorIsStale ? () => { closeAll(); router.refresh(); } : onSkipConfirm}
              retryLabel={skipErrorIsStale ? 'Refresh' : 'Try again'}
            />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onSkipConfirm}
            className="rounded-input bg-bg-surface border border-border-subtle px-3 py-2 text-[13px] text-text-primary hover:bg-chip-active disabled:opacity-60"
          >
            {loading ? 'Skipping…' : 'Skip assignment'}
          </button>
          <button
            type="button"
            onClick={closeAll}
            className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}

function SubmitModal({
  open, onClose, onSkipInstead, topicName, onGraded, onRetrySubmission, result,
}: {
  open: boolean;
  onClose: () => void;
  onSkipInstead: () => void;
  topicName: string;
  onGraded: (g: GradeResponse) => void;
  /** Clears the cached grade result so the form re-mounts blank for another attempt. */
  onRetrySubmission: () => void;
  result: GradeResponse | null;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    // Revoke previous preview to avoid leaking object URLs.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setPreviewUrl(null);
      setFileError(null);
      return;
    }
    const msg = validateSubmitFile(f);
    if (msg) {
      setPreviewUrl(null);
      setFileError(msg);
      e.target.value = ''; // clear the invalid selection so it can't be submitted
      return;
    }
    setFileError(null);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function onCancelGrading(): void {
    controllerRef.current?.abort(new UserCancelled());
  }

  function resetForm(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCaption('');
    setFileError(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleTryAgain(): void {
    resetForm();
    onRetrySubmission();
  }

  async function runSubmit(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError({ headline: 'Pick a photo to submit.', technical: 'missing_image (client)' });
      return;
    }
    const validationMsg = validateSubmitFile(file);
    if (validationMsg) {
      setFileError(validationMsg);
      return;
    }
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(new SubmitTimeout()), SUBMIT_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.set('image', file);
      form.set('caption', caption);
      const r = await fetch('/api/photography/submit', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      await throwIfNotOk(r);
      const data = (await r.json()) as GradeResponse;
      onGraded(data);
    } catch (e) {
      if (e instanceof UserCancelled) {
        // Silent — photo + caption stay exactly as the user left them.
      } else {
        setError(describeError(e));
      }
    } finally {
      clearTimeout(timeoutId);
      controllerRef.current = null;
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await runSubmit();
  }

  const skippableSubmitError = error?.code === 'corrupted_rubric' || error?.code === 'no_active_assignment';

  return (
    <Modal open={open} onClose={onClose} title={`Submit photo — ${topicName}`} maxWidthClass="max-w-2xl">
      {!result ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label htmlFor="photo-file" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Photo
            </label>
            <input
              ref={fileRef}
              id="photo-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onFileChange}
              required
              className="block w-full rounded-input border border-border-subtle bg-bg-base p-2 text-[12px] text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-bg-surface file:px-2 file:py-1 file:text-[12px] file:text-text-primary"
            />
            {fileError && <p className="mt-1 text-[12px] text-delta-down">{fileError}</p>}
            <p className="mt-1 text-[11px] text-text-muted">JPEG, PNG, WebP, or GIF · up to 20MB. RAW (.ARW) isn’t supported yet.</p>
          </div>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-64 rounded-input border border-border-subtle"
            />
          )}
          <div>
            <label htmlFor="photo-caption" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Caption / settings (optional)
            </label>
            <textarea
              id="photo-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Notes, ISO/aperture/shutter if EXIF is stripped, conditions, what you're going for…"
              rows={3}
              className="block w-full rounded-input border border-border-subtle bg-bg-base p-2 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
            />
          </div>
          {loading && <GradingWaitBlock />}
          {error && (
            <ErrorBlock
              error={error}
              onRetry={skippableSubmitError ? onSkipInstead : () => { void runSubmit(); }}
              retryLabel={skippableSubmitError ? 'Skip assignment instead' : 'Try again'}
            />
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || Boolean(fileError)}
              className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110 disabled:opacity-60"
            >
              {loading ? 'Grading…' : 'Submit for grading'}
            </button>
            <button
              type="button"
              onClick={loading ? onCancelGrading : onClose}
              className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <GradeResultView result={result} onClose={onClose} onTryAgain={handleTryAgain} />
      )}
    </Modal>
  );
}

function GradeResultView({
  result,
  onClose,
  onTryAgain,
}: {
  result: GradeResponse;
  onClose: () => void;
  onTryAgain: () => void;
}) {
  return (
    <div className="animate-fade-rise space-y-3">
      {result.verdict === 'pass' ? (
        <PassCelebration result={result} onClose={onClose} />
      ) : (
        <NotYetResult result={result} onClose={onClose} onTryAgain={onTryAgain} />
      )}
    </div>
  );
}

/**
 * Pass state — a win, not confetti. One accent-tinted card (the same
 * chip-active/accent vocabulary used for selection state elsewhere in the
 * app), a momentum line, and the suggested next step promoted into its own
 * highlighted card since it's the most useful thing on the screen right now.
 */
function PassCelebration({ result, onClose }: { result: GradeResponse; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-card border border-chip-active-border bg-chip-active p-4">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-input bg-accent-gradient text-text-primary shadow-accent-glow">
          <CheckIcon size={18} />
        </span>
        <div>
          <div className="text-[16px] font-bold tracking-[-0.01em] text-text-primary">{VERDICT_LABELS.pass}</div>
          <p className="mt-0.5 text-[12px] text-chip-active-text">That completes {result.topicName}.</p>
        </div>
      </div>

      {result.overallCritique && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Critique</div>
          <p className="whitespace-pre-wrap text-[13px] text-text-secondary">{result.overallCritique}</p>
        </section>
      )}

      {result.perCriterion.length > 0 && <PerCriterionList items={result.perCriterion} />}

      {result.suggestedNextStep && (
        <section className="rounded-input border border-chip-active-border bg-bg-base p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent-from">Next up</div>
          <p className="text-[13px] text-text-primary">{result.suggestedNextStep}</p>
        </section>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
      >
        Done
      </button>
    </div>
  );
}

/**
 * Not-yet state — calmer than a failure. Neutral border (no alarm red on the
 * overall banner; per-criterion glyphs below still use delta-down so the
 * detail stays legible), leads with whichever criterion landed best, and a
 * clear Try again affordance since that's the entire point of showing up here.
 */
function NotYetResult({
  result,
  onClose,
  onTryAgain,
}: {
  result: GradeResponse;
  onClose: () => void;
  onTryAgain: () => void;
}) {
  const strongest = sortCriteriaPassFirst(result.perCriterion)[0];
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-border-subtle bg-bg-base p-4">
        <div className="text-[16px] font-bold tracking-[-0.01em] text-text-primary">{VERDICT_LABELS.did_not_pass}</div>
        {strongest && (
          <p className="mt-1 text-[12px] text-text-secondary">
            Strongest so far: <strong className="text-text-primary">{strongest.criterion}</strong>
            {strongest.reason ? ` — ${strongest.reason}` : ''}
          </p>
        )}
      </div>

      {result.overallCritique && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Critique</div>
          <p className="whitespace-pre-wrap text-[13px] text-text-secondary">{result.overallCritique}</p>
        </section>
      )}

      {result.perCriterion.length > 0 && <PerCriterionList items={result.perCriterion} />}

      {result.suggestedNextStep && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Next step</div>
          <p className="text-[13px] text-text-secondary">{result.suggestedNextStep}</p>
        </section>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onTryAgain}
          className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-from motion-reduce:animate-none" />
      {label}
    </div>
  );
}

/**
 * Grading wait state — the one genuinely slow call in the app (vision
 * grading, up to ~90s). Sets a time expectation instead of a bare pulse dot,
 * shows a calm indeterminate sweep instead of a spinner, and reassures that
 * cancelling/resubmitting is always fine so there's no pressure to nail the
 * upload in one try.
 */
function GradingWaitBlock() {
  return (
    <div className="rounded-input border border-border-subtle bg-bg-base p-4">
      <p className="text-[13px] font-medium text-text-primary">Reading your photo — usually 15–30 seconds</p>
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-surface-raised"
        role="progressbar"
        aria-label="Grading in progress"
      >
        <div className="grading-sweep h-full w-1/3 rounded-full bg-accent-gradient" />
      </div>
      <p className="mt-3 text-[12px] text-text-muted">
        Occasionally takes up to a minute for a detailed rubric. Resubmitting is always fine, so there’s no pressure to get it right on the first try.
      </p>
    </div>
  );
}

function ErrorBlock({
  error,
  onRetry,
  retryLabel = 'Try again',
}: {
  error: ErrorState;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-input border border-delta-down/40 bg-delta-down/10 p-2 text-[12px] text-delta-down">
      <p>{error.headline}</p>
      <details className="mt-1">
        <summary className="cursor-pointer select-none text-[11px] text-delta-down/80">Technical details</summary>
        <p className="mt-1 text-[11px] text-delta-down/70">{error.technical}</p>
      </details>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-input border border-delta-down/40 bg-bg-surface px-2 py-1 text-[12px] font-semibold text-text-primary hover:bg-chip-active"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
