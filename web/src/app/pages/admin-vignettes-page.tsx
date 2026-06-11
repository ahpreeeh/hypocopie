import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Pencil,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { PageBreadcrumb } from '../components/design-primitives';
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
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            to="/entrainement"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 flex items-center gap-1"
          >
            <ArrowLeft size={16} /> Entrainement
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-600" />
              Vignettes orphelines
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {data
                ? `${data.affectedAnnales} annale${data.affectedAnnales > 1 ? 's' : ''} / ${data.problematicQuestions} question${data.problematicQuestions > 1 ? 's' : ''} problematique${data.problematicQuestions > 1 ? 's' : ''} sur ${data.totalAnnales} annales (${data.totalQuestions} questions).`
                : 'Diagnostic en cours...'}
            </p>
          </div>
        </div>
      </header>

      <PageBreadcrumb
        items={[
          { label: 'Entrainement', to: '/entrainement' },
          { label: 'Admin' },
          { label: 'Vignettes orphelines' },
        ]}
      />

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-900/40 dark:bg-indigo-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="text-indigo-800 dark:text-indigo-200">
              💡 Une vue unifiée combine ces détections auto avec tes signalements manuels.
            </div>
            <Link
              to="/admin/corrections"
              className="shrink-0 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
            >
              Voir /admin/corrections →
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
            <div className="font-medium">Erreur de chargement</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>
        )}

        {!data && !error && <VignettesLoadingSkeleton />}

        {data && data.annales.length === 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-600 ring-1 ring-green-100 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-800/40">
              <AlertTriangle size={22} strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              Aucune annale problematique detectee
            </h2>
            <p className="mt-2 text-sm">
              Les {data.totalAnnales} annales semblent porter leurs vignettes correctement.
            </p>
          </div>
        )}

        {data && data.annales.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
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
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {sortedAnnales.map((annale) => {
                    const isOpen = !!expanded[annale.id];
                    const rateClass = rateToClass(annale.rate);
                    return (
                      <Fragment key={annale.id}>
                        <tr
                          className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
                          onClick={() => toggleExpand(annale.id)}
                        >
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
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
                            <div className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                              {annale.id}
                            </div>
                            <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {annale.title || '(sans titre)'}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right align-top text-neutral-700 dark:text-neutral-300 tabular-nums">
                            {annale.totalQuestions}
                          </td>
                          <td className="px-3 py-3 text-right align-top font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
                            {annale.problematicCount}
                          </td>
                          <td className="px-3 py-3 text-right align-top tabular-nums">
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${rateClass}`}>
                              {(annale.rate * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <Link
                              to={`/entrainement/${annale.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                              title="Ouvrir cette annale"
                            >
                              <Pencil size={12} />
                              Editer
                            </Link>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-neutral-50/60 dark:bg-neutral-900/40">
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
            ? 'text-neutral-900 dark:text-neutral-100'
            : 'hover:text-neutral-700 dark:hover:text-neutral-300'
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
      <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        QROC
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
      PDF
    </Badge>
  );
}

function rateToClass(rate: number): string {
  if (rate >= 0.3) return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
  if (rate >= 0.15) return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
}

function QuestionList({ annale }: { annale: OrphanAnnale }) {
  if (!annale.questions || annale.questions.length === 0) {
    return (
      <div className="text-xs italic text-neutral-500 dark:text-neutral-400">
        Aucune question listee.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Questions detectees ({annale.questions.length})
      </div>
      <ul className="space-y-1.5">
        {annale.questions.map((q) => (
          <li
            key={q.id}
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {q.id}
              </span>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {q.pattern}
              </span>
            </div>
            <div className="mt-1 text-neutral-700 dark:text-neutral-300">
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
