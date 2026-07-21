'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { Markdown } from './markdown';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const SEND_TIMEOUT_MS = 90_000; // matches the Submit modal ceiling — tool loops are slow

function errorCopy(status: number | null, code: string | null): string {
  if (code === 'busy') return 'Photo brain is still answering — give it a second and resend.';
  if (code === 'invalid_message') return 'Message is empty or too long (4000 char max).';
  if (status === 401) return 'Session expired — reload the page.';
  if (status === null) return 'Timed out or lost connection — your message is back in the box, try again.';
  return 'Something went wrong — your message is back in the box, try again.';
}

/** Current topic page, if the user is on one (server re-validates regardless). */
function topicIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/photography\/([^/]+)$/);
  const seg = m?.[1];
  if (!seg || seg === 'assignments') return undefined;
  return decodeURIComponent(seg);
}

export function PhotoBrainFab() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);

  const inPhotography = pathname.startsWith('/photography')
    || (pathname === '/' && search.get('domain') === 'photography');

  if (!inPhotography) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Photo Brain chat"
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent-gradient text-white shadow-accent-glow transition-transform hover:scale-105"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}
      {open && <PhotoBrainDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoBrainDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate from server history on open; focus the input.
  useEffect(() => {
    fetch('/api/photography/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages: ChatMsg[] }) => setMessages(data.messages))
      .catch(() => { /* empty history is a fine fallback */ });
    inputRef.current?.focus();
  }, []);

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || pending) return;
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setPending(true);
    try {
      const r = await fetch('/api/photography/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, topicId: topicIdFromPath(pathname) }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw Object.assign(new Error('api'), { status: r.status, code: body.error ?? null });
      }
      const data = (await r.json()) as { reply: string };
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      // Roll back the optimistic user turn and put the text back for retry.
      setMessages((prev) => prev.slice(0, -1));
      setInput(message);
      const status = (e as { status?: number }).status ?? null;
      const code = (e as { code?: string }).code ?? null;
      setError(errorCopy(status, code));
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }, [input, pending, pathname]);

  async function newChat() {
    setError(null);
    try {
      await fetch('/api/photography/chat', { method: 'DELETE' });
      setMessages([]);
    } catch {
      setError('Could not clear the conversation — try again.');
    }
  }

  const drawer = (
    <div role="dialog" aria-modal="true" aria-label="Photo Brain" className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-border-subtle bg-bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border-divider px-4 py-3">
          <span className="text-[15px] font-bold tracking-[-0.01em] text-text-primary">Photo Brain</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={newChat}
              disabled={pending || messages.length === 0}
              className="rounded-input px-2 py-1 text-[12px] text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              New chat
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-input px-2 py-1 text-[18px] leading-none text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !pending && (
            <p className="text-[13px] text-text-muted">
              Ask about your current assignment, technique, or shoot planning.
              Weather, sun times, and trails included.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ml-8 rounded-card bg-chip-active px-3 py-2 text-[13px] text-text-primary">
                {m.content}
              </div>
            ) : (
              <div key={i} className="mr-4">
                <Markdown text={m.content} />
              </div>
            ),
          )}
          {pending && (
            <p className="animate-pulse text-[13px] text-text-muted">Thinking…</p>
          )}
        </div>

        {error && (
          <p className="border-t border-border-divider px-4 py-2 text-[12px] text-delta-down">{error}</p>
        )}

        <div className="flex items-end gap-2 border-t border-border-divider px-4 py-3">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            maxLength={4000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask the photo brain… (Enter to send)"
            className="flex-1 resize-none rounded-input border border-border-subtle bg-bg-surface-raised px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={pending || !input.trim()}
            className="rounded-input border border-border-subtle px-3 py-2 text-[13px] font-semibold text-text-primary disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}
