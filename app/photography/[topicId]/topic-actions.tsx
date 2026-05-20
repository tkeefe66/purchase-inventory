'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../../components/modal';
import { Markdown } from '../../components/markdown';

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
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setMode('closed');
    setError(null);
  }

  async function onLearnClick(): Promise<void> {
    setMode('learn');
    setError(null);
    if (learnText) return; // re-open cached
    setLoading(true);
    try {
      const r = await fetch('/api/photography/learn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as { lesson: string };
      setLearnText(data.lesson);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
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
        setError('Existing assignment rubric is malformed — try /skip + start fresh.');
      }
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/photography/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string; activeTopicName?: string };
        if (body.error === 'active_assignment_exists') {
          setError(`Already have an active assignment: ${body.activeTopicName}. Skip it first.`);
          return;
        }
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as StartResponse;
      setStartResult(data);
      // Refresh server data (assignment-history section etc.) once the modal closes.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  async function onSkipConfirm(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/photography/skip', { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setMode('closed');
      // Clear cached state so reopening Start later kicks off a fresh expansion.
      setStartResult(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  function openSubmitFromStart(): void {
    setMode('submit');
    setError(null);
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLearnClick}
          className="rounded-input bg-bg-surface border border-border-subtle px-3 py-2 text-[13px] text-text-primary hover:bg-chip-active"
        >
          📖 Read theory
        </button>
        {hasActiveAssignment ? (
          <>
            <button
              type="button"
              onClick={onStartClick}
              className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
            >
              📤 Submit photo
            </button>
            <button
              type="button"
              onClick={() => setMode('skip')}
              className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:bg-chip-active hover:text-text-primary"
              title="Skip the active assignment for this topic"
            >
              ⊘ Skip assignment
            </button>
          </>
        ) : prereqsMet ? (
          <button
            type="button"
            onClick={onStartClick}
            className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
          >
            🚀 Start assignment
          </button>
        ) : (
          <span
            title="Prereqs not yet completed"
            className="cursor-not-allowed rounded-input border border-dashed border-border-subtle px-3 py-2 text-[13px] text-text-muted"
          >
            🔒 Start assignment
          </span>
        )}
      </div>

      {/* Learn modal */}
      <Modal open={mode === 'learn'} onClose={closeAll} title={`Theory — ${topicName}`} maxWidthClass="max-w-3xl">
        {loading && <LoadingBlock label="Expanding lesson…" />}
        {error && <ErrorBlock message={error} />}
        {!loading && !error && learnText && <Markdown text={learnText} />}
      </Modal>

      {/* Start / current-assignment modal */}
      <Modal open={mode === 'start'} onClose={closeAll} title={`Assignment — ${topicName}`} maxWidthClass="max-w-3xl">
        {loading && <LoadingBlock label="Generating assignment…" />}
        {error && <ErrorBlock message={error} />}
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
                className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110"
              >
                📤 Submit photo
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
        topicName={topicName}
        onGraded={(g) => {
          setGradeResult(g);
          router.refresh();
        }}
        result={gradeResult}
      />

      {/* Skip confirm modal */}
      <Modal open={mode === 'skip'} onClose={closeAll} title="Skip assignment?" maxWidthClass="max-w-md">
        <p className="text-[13px] text-text-secondary">
          Skips your active assignment on this topic. The topic stays available — you can /start it again later.
        </p>
        {error && <div className="mt-3"><ErrorBlock message={error} /></div>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onSkipConfirm}
            className="rounded-input bg-bg-surface border border-border-subtle px-3 py-2 text-[13px] text-text-primary hover:bg-chip-active disabled:opacity-60"
          >
            {loading ? 'Skipping…' : 'Skip it'}
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
  open, onClose, topicName, onGraded, result,
}: {
  open: boolean;
  onClose: () => void;
  topicName: string;
  onGraded: (g: GradeResponse) => void;
  result: GradeResponse | null;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) {
      setPreviewUrl(null);
      return;
    }
    // Revoke previous preview to avoid leaking object URLs.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Pick a photo to submit.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('image', file);
      form.set('caption', caption);
      const r = await fetch('/api/photography/submit', {
        method: 'POST',
        body: form,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as GradeResponse;
      onGraded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

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
          {error && <ErrorBlock message={error} />}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-input bg-accent-gradient px-3 py-2 text-[13px] font-semibold text-text-primary shadow-accent-glow hover:brightness-110 disabled:opacity-60"
            >
              {loading ? 'Grading…' : 'Submit for grading'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <GradeResultView result={result} onClose={onClose} />
      )}
    </Modal>
  );
}

function GradeResultView({ result, onClose }: { result: GradeResponse; onClose: () => void }) {
  const pass = result.verdict === 'pass';
  return (
    <div className="space-y-3">
      <div
        className={`rounded-card border px-3 py-2 text-[14px] font-semibold ${
          pass
            ? 'border-delta-up/40 bg-delta-up/10 text-delta-up'
            : 'border-delta-down/40 bg-delta-down/10 text-delta-down'
        }`}
      >
        {pass ? '✓ Pass' : '✗ Did not pass'}
      </div>
      {result.overallCritique && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Critique</div>
          <p className="whitespace-pre-wrap text-[13px] text-text-secondary">{result.overallCritique}</p>
        </section>
      )}
      {result.perCriterion.length > 0 && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Per criterion</div>
          <ul className="space-y-1">
            {result.perCriterion.map((c, i) => {
              const glyph = c.result === 'pass' ? '✓' : c.result === 'partial' ? '~' : '✗';
              const cls = c.result === 'pass' ? 'text-delta-up' : c.result === 'partial' ? 'text-text-secondary' : 'text-delta-down';
              return (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span className={`w-3 text-center ${cls}`}>{glyph}</span>
                  <span><strong>{c.criterion}</strong>{c.reason ? ` — ${c.reason}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {result.suggestedNextStep && (
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Next step</div>
          <p className="text-[13px] text-text-secondary">{result.suggestedNextStep}</p>
        </section>
      )}
      <button
        type="button"
        onClick={onClose}
        className="rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[13px] text-text-secondary hover:text-text-primary"
      >
        Done
      </button>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-from" />
      {label}
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-input border border-delta-down/40 bg-delta-down/10 p-2 text-[12px] text-delta-down">
      {message}
    </div>
  );
}
