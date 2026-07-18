interface IconProps {
  /** Edge length in px. Icons are square. */
  size?: number;
  className?: string;
}

const shared = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Branch icon — operating-camera. */
export function CameraIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M4 7.5h2.8L8.2 5h7.6l1.4 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.3" />
    </svg>
  );
}

/** Branch icon — seeing. */
export function EyeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** Branch icon — editing. */
export function EditIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M16.7 3.6a2.1 2.1 0 0 1 3 3L7.4 18.9 3 20l1.1-4.4Z" />
      <path d="M14.7 5.6l3.7 3.7" />
    </svg>
  );
}

/** Branch icon — printing. */
export function PrinterIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M6.5 9V4.5h11V9" />
      <rect x="3" y="9" width="18" height="7.5" rx="1.5" />
      <path d="M7 14.5h10v5.5H7Z" />
    </svg>
  );
}

/** Action icon — read theory. */
export function BookOpenIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M12 6.7c-1.6-1.4-4-2.1-6.5-2.1a2 2 0 0 0-2 2V17c2.5 0 5 .7 6.5 2 1.5-1.3 4-2 6.5-2h1.5c.9 0 1.5.05 2 .15V6.75c-.5-.1-1.1-.15-2-.15-2.5 0-4.9.7-6.5 2.1Z" />
      <path d="M12 6.7V19" />
    </svg>
  );
}

/** Action icon — start assignment; also doubles as the in-progress status glyph. */
export function PlayIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M6.5 4.5v15l13-7.5Z" />
    </svg>
  );
}

/** Action icon — submit photo. */
export function UploadIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M12 15.5V4.5" />
      <path d="M7.2 9 12 4.2 16.8 9" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Action icon — skip assignment. */
export function SkipForwardIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M5 5.5v13l9-6.5Z" />
      <path d="M18 5.5v13" />
    </svg>
  );
}

/** Status icon — locked. */
export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

/** Status icon — completed. */
export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

/** Status icon — available. */
export function CircleIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7.2" />
    </svg>
  );
}

/** Status icon — skipped. */
export function SlashIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...shared} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7.2" />
      <path d="M7.3 16.7 16.7 7.3" />
    </svg>
  );
}
