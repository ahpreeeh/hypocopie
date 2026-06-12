import { Fragment, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';
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

export function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  detail?: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
}) {
  const toneClass = {
    neutral: 'bg-muted text-muted-foreground',
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-100',
    success: 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-100',
    warn: 'bg-warn-50 text-warn-700 dark:bg-warn-950/40 dark:text-warn-100',
    danger: 'bg-danger-50 text-danger-700 dark:bg-danger-950/40 dark:text-danger-100',
  }[tone];

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors duration-150 hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-[650] uppercase tracking-[0.07em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-2xl font-[650] tracking-[-0.02em] text-foreground tabular-nums">
            {value}
          </div>
        </div>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-[10px]', toneClass)}>
          <Icon size={18} />
        </div>
      </div>
      {detail && <div className="mt-2 text-xs text-muted-foreground">{detail}</div>}
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

export function PageBreadcrumb({
  items,
}: {
  items: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border/80 bg-card/85 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 py-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return (
                <Fragment key={`${item.label}-${index}`}>
                  <BreadcrumbItem>
                    {isLast || !item.to ? (
                      <BreadcrumbPage className="max-w-[240px] truncate">{item.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={item.to}>{item.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border bg-card px-6 py-5 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-[650] uppercase tracking-[0.09em] text-brand-700 dark:text-brand-100">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[22px] font-[650] tracking-[-0.015em] text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
    </div>
  );
}
