import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, BookOpen, Play, FileText, ScanText, History, Pencil, Save, X, CheckCircle2, Clock, Target, GitMerge, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, KpiCard, PageBreadcrumb } from '../components/design-primitives';
import { humanizeError } from '../ui-feedback';

interface AnnaleDetailQuestion {
  id: string;
  questionType: string;
  text: string;
  seriesId?: string | null;
  seriesFormat?: 'DP' | 'KFP' | null;
  seriesPosition?: number | null;
  seriesTotal?: number | null;
  customTitle?: string | null;
  vignette?: string | null;
}

interface AnnaleDetail {
  id: string;
  title: string;
  questions: AnnaleDetailQuestion[];
}

interface AnnaleSummary {
  id: string;
  title: string;
  subject: string;
  year?: number;
  session?: string;
  questionsCount: number;
}

interface SessionSummary {
  id: string;
  annaleId: string;
  submittedAt: string;
  durationSec?: number;
  score: {
    percentage: number | null;
  };
}

type EditFields = { title: string; subject: string; year: string; session: string; newId: string };

function slugifyId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export type ExamMode = 'exam' | 'libre';

const EXAM_MODE_STORAGE_KEY = 'hypocampus_exam_mode';

export function getStoredExamMode(): ExamMode {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(EXAM_MODE_STORAGE_KEY) : null;
  return raw === 'libre' ? 'libre' : 'exam';
}

export function setStoredExamMode(mode: ExamMode) {
  localStorage.setItem(EXAM_MODE_STORAGE_KEY, mode);
}

export function AnnalesList() {
  const [annales, setAnnales] = useState<AnnaleSummary[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examMode, setExamMode] = useState<ExamMode>(() => getStoredExamMode());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ title: '', subject: '', year: '', session: '', newId: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [regroupAnnaleId, setRegroupAnnaleId] = useState<string | null>(null);

  // Recharge la liste des annales (utilisé après un regroupement réussi).
  const reloadAnnales = async () => {
    try {
      const r = await fetch('/api/annales');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: AnnaleSummary[] = await r.json();
      setAnnales(data);
    } catch {
      // silencieux : un rafraîchissement peut échouer sans détruire la session
    }
  };

  const toggleExamMode = () => {
    const next: ExamMode = examMode === 'exam' ? 'libre' : 'exam';
    setExamMode(next);
    setStoredExamMode(next);
  };

  const startEdit = (a: AnnaleSummary) => {
    setEditingId(a.id);
    setEditFields({
      title: a.title || '',
      subject: a.subject || '',
      year: a.year ? String(a.year) : '',
      session: a.session || '',
      newId: a.id,
    });
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmedTitle = editFields.title.trim();
    if (!trimmedTitle) {
      setEditError('Le titre ne peut pas être vide.');
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = { title: trimmedTitle };
      if (editFields.subject.trim()) payload.subject = editFields.subject.trim();
      if (editFields.year.trim()) {
        const y = Number(editFields.year.trim());
        if (Number.isFinite(y) && y > 1900 && y < 2200) payload.year = y;
        else { setEditError('Année invalide.'); setEditBusy(false); return; }
      } else {
        payload.year = null;
      }
      payload.session = editFields.session.trim();
      // Si newId est rempli ET different de l'ancien → on demande un rename
      const desiredNewId = slugifyId(editFields.newId.trim());
      if (desiredNewId && desiredNewId !== editingId) {
        payload.newId = desiredNewId;
      }
      const response = await fetch(`/api/annales/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      const newId: string = data.id || editingId;
      // Mise à jour locale optimiste (gère le potentiel rename)
      setAnnales((prev) => prev?.map((a) => a.id === editingId ? {
        ...a,
        id: newId,
        title: trimmedTitle,
        subject: (payload.subject as string) ?? a.subject,
        year: payload.year === null ? undefined : (payload.year as number),
        session: (payload.session as string) || undefined,
      } : a) || prev);
      setEditingId(null);
      toast.success('Annale mise a jour');
    } catch (e: any) {
      const message = humanizeError(e);
      setEditError(message);
      toast.error(message);
    } finally {
      setEditBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/annales');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: AnnaleSummary[] = await r.json();
        if (!cancelled) setAnnales(data);
      } catch (e: any) {
        if (!cancelled) {
          const message = humanizeError(e);
          setError(message);
          toast.error('Chargement des annales impossible');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/exam-sessions');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: SessionSummary[] = await r.json();
        if (!cancelled) setSessions(data);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Regroupement par matière
  const grouped = useMemo(() => {
    if (!annales) return [];
    const map = new Map<string, AnnaleSummary[]>();
    for (const a of annales) {
      const key = a.subject || 'Sans matière';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    // Trie chaque groupe par année descendante puis par titre
    for (const list of map.values()) {
      list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'fr'));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [annales]);

  // Index des tentatives par annaleId : count, date dernière, meilleur score
  // Sert au marqueur "déjà fait" subtil sur chaque card.
  const attemptsByAnnale = useMemo(() => {
    const map = new Map<string, { count: number; latestAt: string; bestScore: number | null }>();
    if (!sessions) return map;
    for (const s of sessions) {
      const existing = map.get(s.annaleId);
      const score = s.score?.percentage ?? null;
      if (!existing) {
        map.set(s.annaleId, { count: 1, latestAt: s.submittedAt, bestScore: score });
      } else {
        existing.count++;
        if (new Date(s.submittedAt) > new Date(existing.latestAt)) existing.latestAt = s.submittedAt;
        if (score !== null && (existing.bestScore === null || score > existing.bestScore)) existing.bestScore = score;
      }
    }
    return map;
  }, [sessions]);

  const annaleStats = useMemo(() => {
    if (!annales || annales.length === 0) return null;
    const subjects = new Set(annales.map((a) => a.subject || 'Sans matiere'));
    const totalQuestions = annales.reduce((sum, a) => sum + (a.questionsCount || 0), 0);
    const latestYear = annales.reduce<number | null>((latest, a) => {
      if (!a.year) return latest;
      return latest === null ? a.year : Math.max(latest, a.year);
    }, null);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = (sessions || []).filter((session) => {
      const time = new Date(session.submittedAt).getTime();
      return Number.isFinite(time) && time >= cutoff;
    });
    const scored = recentSessions
      .map((session) => session.score?.percentage)
      .filter((score): score is number => typeof score === 'number');
    const averageScore = scored.length
      ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
      : null;
    const averageDuration = recentSessions.length
      ? Math.round(recentSessions.reduce((sum, session) => sum + (session.durationSec || 0), 0) / recentSessions.length)
      : null;
    return {
      totalAnnales: annales.length,
      totalQuestions,
      subjectsCount: subjects.size,
      latestYear,
      sessionsCount: sessions?.length ?? 0,
      averageScore,
      averageDuration,
    };
  }, [annales, sessions]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            to="/captures"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 flex items-center gap-1"
          >
            <ArrowLeft size={16} /> Cahier d'erreurs
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <BookOpen size={20} className="text-indigo-600" />
              Annales — entraînement examen
            </h1>
            <p className="text-xs text-neutral-500">
              Mode UNESS. Sélectionne une annale pour démarrer.
            </p>
          </div>
          {/* Toggle Mode examen */}
          <button
            onClick={toggleExamMode}
            className="flex items-center gap-2 text-sm select-none group"
            title={
              examMode === 'exam'
                ? "Mode examen ACTIF : correction à la fin uniquement"
                : "Mode entraînement libre : correction après chaque question"
            }
          >
            <span className={`font-medium ${examMode === 'exam' ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'}`}>
              Mode examen
            </span>
            <span
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                examMode === 'exam'
                  ? 'bg-indigo-600'
                  : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform mt-0.5 ${
                  examMode === 'exam' ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>

          <Link
            to="/entrainement/historique"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300"
            title="Historique des sessions"
          >
            <History size={16} />
            Historique
          </Link>

          <Link
            to="/entrainement/import"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm"
          >
            <ScanText size={16} />
            Import local
          </Link>
        </div>

        {/* Sous-bandeau qui rappelle le mode actif */}
        <div className="max-w-5xl mx-auto px-6 pb-3">
          {examMode === 'exam' ? (
            <p className="text-xs text-neutral-500">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium mr-2">
                🎯 EXAMEN
              </span>
              Mode UNESS. Correction à la fin uniquement. Note finale.
            </p>
          ) : (
            <p className="text-xs text-neutral-500">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium mr-2">
                📚 LIBRE
              </span>
              Mode entraînement. Correction directe après chaque "Valider".
            </p>
          )}
        </div>
      </header>

      <PageBreadcrumb items={[{ label: 'Entrainement', to: '/entrainement' }, { label: 'Annales' }]} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 mb-6">
            Erreur de chargement : {error}
          </div>
        )}

        {!annales && !error && (
          <AnnalesListSkeleton />
        )}

        {annaleStats && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <KpiCard icon={BookOpen} label="Annales" value={annaleStats.totalAnnales} detail={`${annaleStats.totalQuestions} questions`} tone="brand" />
            <KpiCard icon={CheckCircle2} label="Sessions" value={annaleStats.sessionsCount} detail={`${annaleStats.subjectsCount} matiere${annaleStats.subjectsCount > 1 ? 's' : ''}`} tone="success" />
            <KpiCard icon={Target} label="Moyenne 30j" value={annaleStats.averageScore === null ? '-' : `${annaleStats.averageScore}%`} detail="Sessions recentes" tone="warn" />
            <KpiCard icon={Clock} label="Moy/exam 30j" value={annaleStats.averageDuration === null ? '-' : formatShortDuration(annaleStats.averageDuration)} detail={annaleStats.latestYear ? `Derniere annee ${annaleStats.latestYear}` : 'Pas de session'} />
          </div>
        )}

        {annales && annales.length === 0 && (
          <EmptyState
            icon={FileText}
            title="Aucune annale pour l'instant"
            description="Importe un sujet corrige pour demarrer un entrainement et alimenter les statistiques."
            action={
              <Link
                to="/entrainement/import"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-indigo-700 hover:shadow-lg active:scale-95"
              >
                <ScanText size={16} />
                Importer une annale
              </Link>
            }
          />
        )}

        {regroupAnnaleId && (
          <RegroupAnnaleModal
            annaleId={regroupAnnaleId}
            onClose={() => setRegroupAnnaleId(null)}
            onSuccess={async () => {
              setRegroupAnnaleId(null);
              await reloadAnnales();
            }}
          />
        )}
        {grouped.map(([subject, list]) => (
          <section key={subject} className="mb-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3">
              {subject} <span className="text-neutral-400 font-normal">({list.length})</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((a) => (
                editingId === a.id ? (
                  <div
                    key={a.id}
                    className="bg-white dark:bg-neutral-800 border-2 border-indigo-400 dark:border-indigo-600 rounded-2xl p-4 space-y-2.5 shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Édition</span>
                      <button onClick={cancelEdit} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100" aria-label="Annuler">
                        <X size={16} />
                      </button>
                    </div>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">Titre</span>
                      <input
                        value={editFields.title}
                        onChange={(e) => setEditFields((f) => ({ ...f, title: e.target.value }))}
                        autoFocus
                        className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">Année</span>
                        <input
                          value={editFields.year}
                          onChange={(e) => setEditFields((f) => ({ ...f, year: e.target.value }))}
                          inputMode="numeric"
                          className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </label>
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">Session</span>
                        <input
                          value={editFields.session}
                          onChange={(e) => setEditFields((f) => ({ ...f, session: e.target.value }))}
                          placeholder="S1, S2…"
                          className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </label>
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">Matière</span>
                        <input
                          value={editFields.subject}
                          onChange={(e) => setEditFields((f) => ({ ...f, subject: e.target.value }))}
                          className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium flex items-center gap-1">
                        Identifiant
                        {editFields.newId !== editingId && editFields.newId && (
                          <span className="text-amber-600 dark:text-amber-400 font-normal">⚠️ rename programmé</span>
                        )}
                      </span>
                      <input
                        value={editFields.newId}
                        onChange={(e) => setEditFields((f) => ({ ...f, newId: slugifyId(e.target.value) }))}
                        className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="text-[10px] text-neutral-400 mt-0.5">
                        Modifier l'ID renomme le fichier sur disque et met à jour l'historique des sessions.
                      </div>
                    </label>
                    {editError && <div className="text-xs text-red-600 dark:text-red-400">{editError}</div>}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={editBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
                      >
                        <Save size={13} />
                        {editBusy ? 'Enregistrement…' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                ) : (() => {
                  // Marqueur "déjà fait" : trait vertical fin sur le bord gauche
                  // + petit point coloré près du titre. Tooltip avec stats.
                  const attempt = attemptsByAnnale.get(a.id);
                  const done = !!attempt;
                  const attemptLabel = attempt
                    ? `Fait ${attempt.count}× — dernière le ${new Date(attempt.latestAt).toLocaleDateString('fr-FR')}`
                      + (attempt.bestScore != null ? ` — meilleur ${attempt.bestScore}%` : '')
                    : 'Jamais joué';
                  return (
                    <div key={a.id} className="relative group">
                      <div className="absolute top-3 right-3 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRegroupAnnaleId(a.id); }}
                          className="p-1.5 rounded-lg bg-white/80 dark:bg-neutral-900/80 backdrop-blur border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                          title="Regrouper des questions QI en DP"
                          aria-label="Regrouper des questions QI en DP"
                        >
                          <GitMerge size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(a); }}
                          className="p-1.5 rounded-lg bg-white/80 dark:bg-neutral-900/80 backdrop-blur border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                          title="Renommer l'annale"
                          aria-label="Renommer"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                      <Link
                        to={`/entrainement/${a.id}`}
                        title={attemptLabel}
                        className={`relative block bg-white dark:bg-neutral-800 border rounded-2xl p-5 hover:shadow-md transition-all
                          ${done
                            ? 'border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-400 dark:hover:border-emerald-700'
                            : 'border-neutral-200 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-700'}`}
                      >
                        {done && (
                          <span
                            aria-hidden="true"
                            className="absolute top-0 left-0 h-full w-1 rounded-l-2xl bg-emerald-400/80 dark:bg-emerald-500/70"
                          />
                        )}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0 pr-7">
                            <h3 className="font-bold text-neutral-900 dark:text-neutral-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                              {done && (
                                <span
                                  aria-hidden="true"
                                  className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                                />
                              )}
                              <span className="truncate">{a.title}</span>
                            </h3>
                            <div className="text-xs text-neutral-500 mt-1">
                              {a.year && <span>{a.year}</span>}
                              {a.session && <span> · {a.session}</span>}
                              {done && (
                                <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                                  · fait {attempt.count}×
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-neutral-500">{a.questionsCount} questions</span>
                          <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play size={14} /> {done ? 'Refaire' : 'Démarrer'}
                          </span>
                        </div>
                      </Link>
                    </div>
                  );
                })()
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function formatShortDuration(seconds: number): string {
  if (!seconds || seconds < 60) return `${Math.max(0, seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

function RegroupAnnaleModal({
  annaleId,
  onClose,
  onSuccess,
}: {
  annaleId: string;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const [annale, setAnnale] = useState<AnnaleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'select' | 'form'>('select');
  const [form, setForm] = useState<{ title: string; vignette: string; format: 'DP' | 'KFP' }>({ title: '', vignette: '', format: 'DP' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      try {
        const r = await fetch(`/api/annales/${annaleId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: AnnaleDetail = await r.json();
        if (!cancelled) setAnnale(data);
      } catch (e: any) {
        if (!cancelled) setFetchError(humanizeError(e));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [annaleId]);

  const qiQuestions = useMemo(() => {
    if (!annale) return [] as AnnaleDetailQuestion[];
    return annale.questions.filter((q) => !q.seriesFormat);
  }, [annale]);

  const orderedSelected = useMemo(() => {
    if (!annale) return [] as AnnaleDetailQuestion[];
    return annale.questions.filter((q) => selectedIds.has(q.id) && !q.seriesFormat);
  }, [annale, selectedIds]);

  const toggle = (qid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const goToForm = () => {
    if (orderedSelected.length < 2) return;
    setFormError(null);
    setStep('form');
  };

  const submit = async () => {
    const title = form.title.trim();
    if (!title) {
      setFormError('Titre du dossier requis.');
      return;
    }
    if ((form.vignette || '').trim().length < 20) {
      setFormError('Vignette trop courte (min 20 caractères).');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/annales/${annaleId}/regroup-to-dp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionIds: orderedSelected.map((q) => q.id),
          seriesTitle: title,
          vignette: form.vignette,
          seriesFormat: form.format,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      toast.success(`${data?.questionsAffected || orderedSelected.length} questions regroupées en ${form.format}`);
      await onSuccess();
    } catch (e: any) {
      const message = humanizeError(e);
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="regroup-annale-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
          <h2 id="regroup-annale-title" className="text-base font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <GitMerge size={18} className="text-indigo-600" />
            {step === 'select'
              ? `Regrouper des questions QI · ${annale?.title || annaleId}`
              : `Définir le dossier · ${orderedSelected.length} questions`}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {step === 'select' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {loadingDetail && (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 size={14} className="animate-spin" />
                Chargement des questions…
              </div>
            )}
            {fetchError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                {fetchError}
              </div>
            )}
            {!loadingDetail && !fetchError && qiQuestions.length === 0 && (
              <div className="text-sm text-neutral-500">
                Aucune question QI (hors série) à regrouper dans cette annale.
              </div>
            )}
            {qiQuestions.length > 0 && (
              <>
                <p className="text-xs text-neutral-500">
                  Sélectionne au moins 2 questions QI à regrouper en série DP/KFP.
                  L'ordre de cochage suit l'ordre des questions dans l'annale.
                </p>
                <ul className="space-y-2">
                  {qiQuestions.map((q, idx) => {
                    const checked = selectedIds.has(q.id);
                    return (
                      <li
                        key={q.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${checked ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(q.id)}
                          className="mt-1 h-4 w-4 cursor-pointer accent-indigo-600"
                          aria-label={`Sélectionner ${q.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
                            <span className="font-mono">Q{idx + 1}</span>
                            <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 font-medium">
                              {q.questionType}
                            </span>
                            <span className="text-neutral-400 font-mono">{q.id}</span>
                          </div>
                          <div className="text-sm text-neutral-800 dark:text-neutral-200 line-clamp-3">
                            {q.text}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {step === 'form' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-xs text-neutral-500">
              Les {orderedSelected.length} questions sélectionnées vont être rattachées
              à un nouveau dossier clinique partagé. La vignette ne sera portée
              que par la première question.
            </p>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-neutral-600 dark:text-neutral-400">
                Format
              </span>
              <select
                value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value as 'DP' | 'KFP' })}
                className="mt-1 w-32 px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="DP">DP</option>
                <option value="KFP">KFP</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-neutral-600 dark:text-neutral-400">
                Titre du dossier
              </span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex : Insuffisance cardiaque chez Mme X"
                autoFocus
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-neutral-600 dark:text-neutral-400">
                Vignette clinique (min 20 caractères)
              </span>
              <textarea
                value={form.vignette}
                onChange={(e) => setForm({ ...form, vignette: e.target.value })}
                placeholder="Énoncé clinique partagé par toutes les questions de la série"
                className="mt-1 w-full min-h-[160px] px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-neutral-400 mt-0.5 block">
                {(form.vignette || '').trim().length} / min 20 caractères
              </span>
            </label>
            {formError && (
              <div className="text-xs text-red-600 dark:text-red-400">{formError}</div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 p-4 border-t border-neutral-200 dark:border-neutral-800">
          {step === 'select' ? (
            <>
              <span className="text-xs text-neutral-500">
                {orderedSelected.length} sélectionnée(s)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Annuler
                </button>
                <button
                  onClick={goToForm}
                  disabled={orderedSelected.length < 2}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 disabled:hover:bg-indigo-600"
                >
                  <GitMerge size={15} />
                  Suivant
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep('select'); setFormError(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Retour
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Annuler
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />}
                  {busy ? 'Regroupement…' : 'Confirmer'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnalesListSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-3">
          <Skeleton className="h-4 w-36 rounded" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 space-y-4"
              >
                <div className="space-y-2">
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
