import { cn } from './utils';

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; title?: string }>;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-input border border-border bg-muted p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-card text-foreground shadow-[var(--shadow-card)] ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
