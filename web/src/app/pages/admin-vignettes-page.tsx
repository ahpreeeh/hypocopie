import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Lightbulb,
  Pencil,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { PageHeader } from '../components/design-primitives';
import { humanizeError } from '../ui-feedback';

// ────────────────────────────────────────────────────────────────────
// Types alignés sur la réponse de /api/admin/orphan-vignettes
// ────────────────────────────────────────────────────────────────────

interface OrphanQuestion {
  id: string;
  pattern: string;
  textExcerpt: string;
}

interface OrphanAnnale {
  id: string;
  title: string | null;
  subject: string | null;
  year: number | null;
  session: string | null;
  source: 'qroc' | 'pdf';
  totalQuestions: number;
  problematicCount: number;
  rate: number;
  questions: OrphanQuestion[];
}

interface OrphanResponse {
  totalAnnales: number;
  affectedAnnales: number;
  totalQuestions: number;
  problematicQuestions: number;
  annales: OrphanAnnale[];
}

type SortKey = 'source' | 'id' | 'totalQuestions' | 'problematicCount' | 'rate';
type SortDir = 'asc' | 'desc';

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────

export function AdminVignettesPage() {
  const [data, setData] = useState<OrphanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>('rate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/orphan-vignettes');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json: OrphanResponse = await response.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(humanizeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedAnnales = useMemo(() => {
    if (!data) return [];
    const copy = [...data.annales];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case 'source':
          av = a.source;
          bv = b.source;
          break;
        case 'id':
          av = a.id || '';
          bv = b.id || '';
          break;
        case 'totalQuestions':
          av = a.totalQuestions;
          bv = b.totalQuestions;
          break;
        case 'problematicCount':
          av = a.problematicCount;
          bv = b.problematicCount;
          break;
        case 'rate':
        default:
          av = a.rate;
          bv = b.rate;
          break;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Par défaut, rates/counts en desc, ids en asc
      setSortDir(key === 'id' || key === 'source' ? 'asc' : 'desc');
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <PageHeader
        title="Vignettes orphelines"
        description={data
          ? `${data.affectedAnnales} annale${data.affectedAnnales > 1 ? 's' : ''} / ${data.problematicQuestions} question${data.problematicQuestions > 1 ? 's' : ''} problematique${data.problematicQuestions > 1 ? 's' : ''} sur ${data.totalAnnales} annales (${data.totalQuestions} questions).`
          : 'Diagnostic en cours...'}
        crumbs={[{ label: 'Tableau de bord', to: '/entrainement' }, { label: 'Maintenance' }]}
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-input border border-border bg-muted p-0.5">
            <Link to="/admin/corrections" className="rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              Corrections
            </Link>
            <span className="rounded-[8px] bg-card px-3 py-1.5 text-[13px] font-medium text-foreground shadow-[var(--shadow-card)] ring-1 ring-border">
              Vignettes
            </span>
          </div>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="rounded-card border border-brand-100 bg-brand-50 px-4 py-3 text-sm dark:border-brand-700/40 dark:bg-brand-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-brand-950 dark:text-brand-100">
              <Lightbulb size={14} className="shrink-0" />
              Une vue unifiée combine ces détections auto avec tes signalements manuels.
            </div>
            <Link
              to="/admin/corrections"
              className="shrink-0 rounded-input border border-brand-100 bg-card px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:border-brand-700/40 dark:bg-brand-950/40 dark:text-brand-100"
            >
              Voir /admin/corrections →
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-input border border-danger-100 bg-danger-50 p-4 text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-500">
            <div className="font-medium">Erreur de chargement</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>
        )}

        {!data && !error && <VignettesLoadingSkeleton />}

        {data && data.annales.length === 0 && (
          <div className="rounded-card border border-border bg-card p-8 text-center text-muted-foreground shadow-[var(--shadow-card)]">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-success-50 text-success-700 ring-1 ring-success-100 dark:bg-success-950/40 dark:text-success-500 dark:ring-success-700/40">
              <AlertTriangle size={22} strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-medium text-foreground">
              Aucune annale problematique detectee
            </h2>
            <p className="mt-2 text-sm">
              Les {data.totalAnnales} annales semblent porter leurs vignettes correctement.
            </p>
          </div>
        )}

        {data && data.annales.length > 0 && (
          <div className="rounded-card border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-3 text-left"></th>
                    <SortableHeader
                      label="Source"
                      sortKey="source"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      className="w-24"
                    />
                    <SortableHeader
                      label="Annale"
                      sortKey="id"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    <SortableHeader
                      label="Total Q"
                      sortKey="totalQuestions"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Problematiques"
                      sortKey="problematicCount"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      className="text-right"
                    />
                    <SortableHeader
                      label="Taux"
                      sortKey="rate"
                      currentKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      className="text-right"
                    />
                    <th className="px-3 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedAnnales.map((annale) => {
                    const isOpen = !!expanded[annale.id];
                    const rateClass = rateToClass(annale.rate);
                    return (
                      <Fragment key={annale.id}>
                        <tr
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleExpand(annale.id)}
                        >
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={isOpen ? 'Replier' : 'Deplier'}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(annale.id);
                              }}
                            >
                              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <SourceBadge source={annale.source} />
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-mono text-xs text-muted-foreground">
                              {annale.id}
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {annale.title || '(sans titre)'}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right align-top text-muted-foreground tabular-nums">
                            {annale.totalQuestions}
                          </td>
                          <td className="px-3 py-3 text-right align-top font-[650] text-foreground tabular-nums">
                            {annale.problematicCount}
                          </td>
                          <td className="px-3 py-3 text-right align-top tabular-nums">
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-[650] ${rateClass}`}>
                              {(annale.rate * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <Link
                              to={`/entrainement/${annale.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-input border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Ouvrir cette annale"
                            >
                              <Pencil size={12} />
                              Editer
                            </Link>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-muted/40">
                            <td colSpan={7} className="px-3 py-3">
                              <QuestionList annale={annale} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────────────────

function SortableHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === currentKey;
  return (
    <th className={`px-3 py-3 font-medium ${className || ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors ${
          active
            ? 'text-foreground'
            : 'hover:text-foreground'
        }`}
      >
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp size={12} />
          ) : (
            <ArrowDown size={12} />
          )
        ) : (
          <ChevronsUpDown size={12} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function SourceBadge({ source }: { source: 'qroc' | 'pdf' }) {
  if (source === 'qroc') {
    return (
      <Badge className="border-transparent bg-warn-100 text-warn-700 dark:bg-warn-950/40 dark:text-warn-100">
        QROC
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-100">
      PDF
    </Badge>
  );
}

function rateToClass(rate: number): string {
  if (rate >= 0.3) return 'bg-danger-100 text-danger-700 dark:bg-danger-950/40 dark:text-danger-500';
  if (rate >= 0.15) return 'bg-warn-100 text-warn-700 dark:bg-warn-950/40 dark:text-warn-100';
  return 'bg-muted text-muted-foreground';
}

function QuestionList({ annale }: { annale: OrphanAnnale }) {
  if (!annale.questions || annale.questions.length === 0) {
    return (
      <div className="text-xs italic text-muted-foreground">
        Aucune question listee.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-[650] uppercase tracking-wider text-muted-foreground">
        Questions detectees ({annale.questions.length})
      </div>
      <ul className="space-y-1.5">
        {annale.questions.map((q) => (
          <li
            key={q.id}
            className="rounded-input border border-border bg-card px-3 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {q.id}
              </span>
              <span className="rounded bg-warn-50 px-1.5 py-0.5 font-mono text-[10px] text-warn-700 dark:bg-warn-950/40 dark:text-warn-100">
                {q.pattern}
              </span>
            </div>
            <div className="mt-1 text-muted-foreground">
              {q.textExcerpt}
              {q.textExcerpt.length >= 100 ? '...' : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VignettesLoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
