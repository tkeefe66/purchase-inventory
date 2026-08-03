import { signIn } from '../../auth';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-[360px] rounded-card border border-border-subtle bg-bg-surface p-8 text-center shadow-card">
        <h1 className="text-[17px] font-bold tracking-[-0.01em] text-text-primary">Inventory</h1>
        <p className="mt-2 text-[13px] text-text-secondary">
          Sign in with your Google account to continue.
        </p>
        <form
          className="mt-6"
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-input bg-accent-gradient px-4 py-2.5 text-[13px] font-semibold text-white shadow-accent-glow transition-transform hover:scale-[1.02]"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
