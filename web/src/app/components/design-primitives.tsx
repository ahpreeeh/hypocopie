import { Fragment, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from './ui/utils';

export function DisabledHint({
  active,
  message,
  children,
  className,
}: {
  active: boolean;
  message: string;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex cursor-not-allowed', className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{message}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-card bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-100 dark:ring-brand-700/40">
        <Icon size={30} strokeWidth={1.8} />
      </div>
      <h2 className="text-h3 font-[650] text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function MiniSparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const clean = values.filter((value) => Number.isFinite(value));
  const width = 120;
  const height = 34;
  const pad = 3;
  if (clean.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-8 w-28 text-muted-foreground/40', className)} aria-hidden="true">
        <path d={`M ${pad} ${height / 2} H ${width - pad}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = Math.max(1, max - min);
  const points = clean.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, clean.length - 1);
    const y = height - pad - ((value - min) * (height - pad * 2)) / span;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-8 w-28 text-brand-600 dark:text-brand-100', className)} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Header de page unifié : fil d'ariane inline (optionnel), titre, description,
 * actions à droite. Remplace les bandeaux empilés (header custom + breadcrumb
 * sticky) de l'ancien layout — un seul bloc, une seule hiérarchie.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  crumbs,
  maxWidth = 'max-w-6xl',
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  crumbs?: Array<{ label: string; to?: string }>;
  maxWidth?: string;
}) {
  return (
    <header className="border-b border-border bg-card">
      <div className={cn('mx-auto flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-5', maxWidth)}>
        <div className="min-w-0 flex-1">
          {crumbs && crumbs.length > 0 && (
            <nav aria-label="Fil d'ariane" className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {crumbs.map((crumb, index) => (
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && <ChevronRight size={11} aria-hidden="true" className="text-muted-foreground/50" />}
                  {crumb.to ? (
                    <Link to={crumb.to} className="transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </Fragment>
              ))}
            </nav>
          )}
          {eyebrow && (
            <div className="mb-1 text-[11px] font-[650] uppercase tracking-[0.09em] text-brand-700 dark:text-brand-100">
              {eyebrow}
            </div>
          )}
          <h1 className="truncate text-[22px] font-[650] tracking-[-0.015em] text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Barre de statistiques compacte : une seule card découpée en cellules,
 * façon tableau de bord d'outil pro. Remplace les grilles de KpiCard.
 */
export function StatBar({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; detail?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-[var(--shadow-card)] lg:grid-cols-4',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-0.5 text-lg font-[650] tabular-nums tracking-[-0.01em] text-foreground">
            {item.value}
          </div>
          {item.detail && <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>}
        </div>
      ))}
    </div>
  );
}
