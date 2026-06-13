import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, FileText, GitMerge, History, Loader2, Pencil, Play, Save, ScanText, X } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, PageHeader, StatBar } from '../components/design-primitives';
import { SegmentedControl } from '../components/ui/segmented-control';
import { humanizeError, scoreTextClass } from '../ui-feedback';

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
  studyYear?: string | null;
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

type EditFields = { title: string; subject: string; year: string; session: string; studyYear: string; newId: string };

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
type GroupBy = 'subject' | 'studyYear';

const EXAM_MODE_STORAGE_KEY = 'hypocampus_exam_mode';
const ANNALES_GROUP_KEY = 'hypocampus_annales_group_by';

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

  const selectExamMode = (next: ExamMode) => {
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
      studyYear: a.studyYear || '',
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
      payload.studyYear = editFields.studyYear.trim();
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
        studyYear: (payload.studyYear as string) || null,
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

  // Rangement de la bibliothèque : sections par matière ou par année (persisté).
  const [groupBy, setGroupBy] = useState<GroupBy>(() =>
    localStorage.getItem(ANNALES_GROUP_KEY) === 'studyYear' ? 'studyYear' : 'subject');
  const selectGroupBy = (next: GroupBy) => {
    setGroupBy(next);
    localStorage.setItem(ANNALES_GROUP_KEY, next);
  };

  const grouped = useMemo(() => {
    if (!annales) return [];
    const map = new Map<string, AnnaleSummary[]>();
    for (const a of annales) {
      const key = groupBy === 'studyYear'
        ? (a.studyYear?.trim() || 'Sans niveau')
        : (a.subject || 'Sans matière');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    if (groupBy === 'studyYear') {
      // Sections par niveau (A→Z, « Sans niveau » en dernier) ; dans chaque
      // niveau : matière puis année desc puis titre.
      for (const list of map.values()) {
        list.sort((a, b) =>
          (a.subject || '').localeCompare(b.subject || '', 'fr')
          || (b.year || 0) - (a.year || 0)
          || a.title.localeCompare(b.title, 'fr'));
      }
      return Array.from(map.entries()).sort((a, b) => {
        if (a[0] === 'Sans niveau') return 1;
        if (b[0] === 'Sans niveau') return -1;
        return a[0].localeCompare(b[0], 'fr', { numeric: true });
      });
    }
    // Par matière : sections A→Z ; dans chaque matière : année desc puis titre.
    for (const list of map.values()) {
      list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'fr'));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [annales, groupBy]);

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

  const latestSession = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const latest = [...sessions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    const annale = annales?.find((item) => item.id === latest.annaleId) || null;
    return { session: latest, annale };
  }, [annales, sessions]);

  // Copies en cours : drafts exam_* (version 2) du localStorage, restaurées
  // automatiquement par exam-page à l'ouverture de l'annale.
  const inProgressDrafts = useMemo(() => {
    if (!annales) return [];
    const byId = new Map(annales.map((a) => [a.id, a]));
    const drafts: Array<{
      annaleId: string;
      title: string;
      questionsCount: number;
      currentIndex: number;
      elapsedSec: number;
      examMode: string;
      updatedAt: string;
    }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('exam_') || key.startsWith('exam_marks_')) continue;
      const annaleId = key.slice('exam_'.length);
      const annale = byId.get(annaleId);
      if (!annale) continue;
      try {
        const draft = JSON.parse(localStorage.getItem(key) || '');
        if (!draft || draft.version !== 2) continue;
        drafts.push({
          annaleId,
          title: annale.title,
          questionsCount: annale.questionsCount || 0,
          currentIndex: Number(draft.currentIndex) || 0,
          elapsedSec: Number(draft.elapsedSec) || 0,
          examMode: draft.examMode === 'libre' ? 'libre' : 'exam',
          updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : '',
        });
      } catch {
        // draft illisible : ignoré, exam-page le réinitialisera
      }
    }
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [annales]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <PageHeader
        title="Tableau de bord"
        description={examMode === 'exam'
          ? 'Mode examen — correction à la fin, note finale.'
          : 'Mode libre — correction après chaque question validée.'}
        actions={
          <SegmentedControl
            ariaLabel="Mode de correction"
            value={examMode}
            onChange={selectExamMode}
            options={[
              { value: 'exam', label: 'Examen', title: 'Correction à la fin uniquement, comme à l\'EDN' },
              { value: 'libre', label: 'Libre', title: 'Correction après chaque question validée' },
            ]}
          />
        }
      />

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="p-4 rounded-input bg-danger-50 dark:bg-danger-950/30 text-danger-700 dark:text-danger-500 mb-6">
            Erreur de chargement : {error}
          </div>
        )}

        {!annales && !error && (
          <AnnalesListSkeleton />
        )}

        {inProgressDrafts.length > 0 && (
          <section className="mb-6 rounded-card border border-brand-100 bg-brand-50/60 p-5 shadow-[var(--shadow-card)] dark:border-brand-700/40 dark:bg-brand-950/30">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-[650] uppercase tracking-[0.09em] text-brand-700 dark:text-brand-100">
                  Copie en cours
                </div>
                <h2 className="mt-1 truncate text-base font-[650] text-foreground">
                  {inProgressDrafts[0].title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Question {inProgressDrafts[0].currentIndex + 1}
                  {inProgressDrafts[0].questionsCount ? ` / ${inProgressDrafts[0].questionsCount}` : ''}
                  {inProgressDrafts[0].elapsedSec > 0 ? ` · ${formatShortDuration(inProgressDrafts[0].elapsedSec)} écoulées` : ''}
                  {` · mode ${inProgressDrafts[0].examMode === 'libre' ? 'libre' : 'examen'}`}
                </p>
                {inProgressDrafts.length > 1 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Également en cours :{' '}
                    {inProgressDrafts.slice(1, 4).map((draft, index) => (
                      <span key={draft.annaleId}>
                        {index > 0 && ', '}
                        <Link to={`/entrainement/${draft.annaleId}`} className="underline decoration-border underline-offset-2 transition-colors hover:text-foreground">
                          {draft.title}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <Link
                to={`/entrainement/${inProgressDrafts[0].annaleId}`}
                className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                <Play size={15} />
                Reprendre
              </Link>
            </div>
          </section>
        )}

        {!inProgressDrafts.length && latestSession && (
          <section className="mb-6 rounded-card border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-[650] uppercase tracking-[0.09em] text-brand-700 dark:text-brand-100">
                  Dernière copie
                </div>
                <h2 className="mt-1 truncate text-base font-[650] text-foreground">
                  {latestSession.annale?.title || latestSession.session.annaleId}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(latestSession.session.submittedAt).toLocaleDateString('fr-FR')}
                  {latestSession.session.durationSec ? ` - ${formatShortDuration(latestSession.session.durationSec)}` : ''}
                  {typeof latestSession.session.score?.percentage === 'number' ? ` - ${latestSession.session.score.percentage}%` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/entrainement/historique"
                  className="inline-flex items-center gap-2 rounded-input border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <History size={15} />
                  Voir l'historique
                </Link>
                <Link
                  to={`/entrainement/${latestSession.session.annaleId}`}
                  className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                >
                  <Play size={15} />
                  Refaire
                </Link>
              </div>
            </div>
          </section>
        )}

        {annaleStats && (
          <StatBar
            className="mb-8"
            items={[
              { label: 'Annales', value: annaleStats.totalAnnales, detail: `${annaleStats.totalQuestions} questions` },
              { label: 'Sessions', value: annaleStats.sessionsCount, detail: `${annaleStats.subjectsCount} matière${annaleStats.subjectsCount > 1 ? 's' : ''}` },
              { label: 'Moyenne 30 j', value: annaleStats.averageScore === null ? '—' : `${annaleStats.averageScore}%`, detail: 'Sessions récentes' },
              { label: 'Durée / examen', value: annaleStats.averageDuration === null ? '—' : formatShortDuration(annaleStats.averageDuration), detail: annaleStats.latestYear ? `Dernière année ${annaleStats.latestYear}` : 'Pas de session' },
            ]}
          />
        )}

        {annales && annales.length === 0 && (
          <EmptyState
            icon={FileText}
            title="Aucune annale pour l'instant"
            description="Importe un sujet corrige pour demarrer un entrainement et alimenter les statistiques."
            action={
              <Link
                to="/entrainement/import"
                className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-card)] transition-colors hover:bg-brand-700"
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
        {annales && annales.length > 0 && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Ranger par</span>
            <SegmentedControl
              ariaLabel="Ranger les annales"
              value={groupBy}
              onChange={selectGroupBy}
              options={[
                { value: 'subject', label: 'Matière', title: 'Sections par matière' },
                { value: 'studyYear', label: 'Niveau', title: "Sections par année d'études (MED3, DFGSM3…)" },
              ]}
            />
          </div>
        )}

        {grouped.map(([groupLabel, list]) => (
          <section key={groupLabel} className="mb-8">
            <h2 className="mb-2 px-1 text-[12px] font-[650] uppercase tracking-[0.09em] text-muted-foreground">
              {groupLabel} <span className="text-muted-foreground/70 font-normal">· {list.length}</span>
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-[var(--shadow-card)]">
              {list.map((a) => (
                editingId === a.id ? (
                  <div
                    key={a.id}
                    className="space-y-2.5 border-l-2 border-brand-500 bg-brand-50/40 p-4 dark:bg-brand-950/20"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-[650] uppercase tracking-[0.09em] text-brand-700 dark:text-brand-100">Édition</span>
                      <button onClick={cancelEdit} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Annuler">
                        <X size={16} />
                      </button>
                    </div>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Titre</span>
                      <input
                        value={editFields.title}
                        onChange={(e) => setEditFields((f) => ({ ...f, title: e.target.value }))}
                        autoFocus
                        className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Année</span>
                        <input
                          value={editFields.year}
                          onChange={(e) => setEditFields((f) => ({ ...f, year: e.target.value }))}
                          inputMode="numeric"
                          className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Session</span>
                        <input
                          value={editFields.session}
                          onChange={(e) => setEditFields((f) => ({ ...f, session: e.target.value }))}
                          placeholder="S1, S2…"
                          className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                      <label className="block col-span-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Matière</span>
                        <input
                          value={editFields.subject}
                          onChange={(e) => setEditFields((f) => ({ ...f, subject: e.target.value }))}
                          className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Niveau (année d'études)</span>
                      <input
                        value={editFields.studyYear}
                        onChange={(e) => setEditFields((f) => ({ ...f, studyYear: e.target.value }))}
                        placeholder="MED3, DFGSM3…"
                        className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
                        Identifiant
                        {editFields.newId !== editingId && editFields.newId && (
                          <span className="text-warn-700 dark:text-warn-500 font-normal">rename programmé</span>
                        )}
                      </span>
                      <input
                        value={editFields.newId}
                        onChange={(e) => setEditFields((f) => ({ ...f, newId: slugifyId(e.target.value) }))}
                        className="mt-0.5 w-full rounded-input border border-input bg-input-background px-2.5 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Modifier l'ID renomme le fichier sur disque et met à jour l'historique des sessions.
                      </div>
                    </label>
                    {editError && <div className="text-xs text-danger-700 dark:text-danger-500">{editError}</div>}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={cancelEdit}
                        className="rounded-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={editBusy}
                        className="inline-flex items-center gap-1.5 rounded-input bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                      >
                        <Save size={13} />
                        {editBusy ? 'Enregistrement…' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                ) : (() => {
                  // Ligne dense : état fait (point sauge), titre, méta, score
                  // coloré + tentatives, actions au survol, toute la ligne clique.
                  const attempt = attemptsByAnnale.get(a.id);
                  const done = !!attempt;
                  const attemptLabel = attempt
                    ? `Fait ${attempt.count}× — dernière le ${new Date(attempt.latestAt).toLocaleDateString('fr-FR')}`
                      + (attempt.bestScore != null ? ` — meilleur ${attempt.bestScore}%` : '')
                    : 'Jamais joué';
                  return (
                    <div
                      key={a.id}
                      title={attemptLabel}
                      className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? 'bg-success-500' : 'bg-border'}`}
                      />
                      <Link
                        to={`/entrainement/${a.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 after:absolute after:inset-0 after:content-['']"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-100">
                          {a.title}
                        </span>
                        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground sm:block">
                          {groupBy === 'studyYear'
                            ? [a.subject, a.year].filter(Boolean).join(' · ')
                            : [a.year, a.session, a.studyYear].filter(Boolean).join(' · ')}
                        </span>
                        <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
                          {a.questionsCount} questions
                        </span>
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums">
                          {attempt ? (
                            <>
                              {attempt.bestScore != null && (
                                <span className={`font-[650] ${scoreTextClass(attempt.bestScore)}`}>{attempt.bestScore}%</span>
                              )}
                              <span className="text-muted-foreground">{attempt.bestScore != null ? ' · ' : ''}{attempt.count}×</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </span>
                      </Link>
                      <div className="relative z-10 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRegroupAnnaleId(a.id); }}
                          className="rounded-input p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-brand-700"
                          title="Regrouper des questions QI en DP"
                          aria-label="Regrouper des questions QI en DP"
                        >
                          <GitMerge size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(a); }}
                          className="rounded-input p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-brand-700"
                          title="Renommer l'annale"
                          aria-label="Renommer"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                      <ChevronRight
                        size={15}
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-brand-700"
                      />
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
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-card border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="regroup-annale-title" className="text-base font-medium text-foreground flex items-center gap-2">
            <GitMerge size={18} className="text-brand-700" />
            {step === 'select'
              ? `Regrouper des questions QI · ${annale?.title || annaleId}`
              : `Définir le dossier · ${orderedSelected.length} questions`}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-input text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {step === 'select' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {loadingDetail && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Chargement des questions…
              </div>
            )}
            {fetchError && (
              <div className="p-3 rounded-input bg-danger-50 dark:bg-danger-950/30 text-danger-700 dark:text-danger-500 text-sm">
                {fetchError}
              </div>
            )}
            {!loadingDetail && !fetchError && qiQuestions.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Aucune question QI (hors série) à regrouper dans cette annale.
              </div>
            )}
            {qiQuestions.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  Sélectionne au moins 2 questions QI à regrouper en série DP/KFP.
                  L'ordre de cochage suit l'ordre des questions dans l'annale.
                </p>
                <ul className="space-y-2">
                  {qiQuestions.map((q, idx) => {
                    const checked = selectedIds.has(q.id);
                    return (
                      <li
                        key={q.id}
                        className={`flex items-start gap-3 rounded-input border p-3 ${checked ? 'border-brand-100 bg-brand-50/60 dark:border-brand-700/40 dark:bg-brand-950/30' : 'border-border'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(q.id)}
                          className="mt-1 h-4 w-4 cursor-pointer accent-brand-600"
                          aria-label={`Sélectionner ${q.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="font-mono">Q{idx + 1}</span>
                            <span className="px-1.5 py-0.5 rounded bg-muted font-medium">
                              {q.questionType}
                            </span>
                            <span className="text-muted-foreground/70 font-mono">{q.id}</span>
                          </div>
                          <div className="text-sm text-foreground line-clamp-3">
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
            <p className="text-xs text-muted-foreground">
              Les {orderedSelected.length} questions sélectionnées vont être rattachées
              à un nouveau dossier clinique partagé. La vignette ne sera portée
              que par la première question.
            </p>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Format
              </span>
              <select
                value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value as 'DP' | 'KFP' })}
                className="mt-1 w-32 px-2.5 py-1.5 rounded-input border border-input bg-input-background text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="DP">DP</option>
                <option value="KFP">KFP</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Titre du dossier
              </span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex : Insuffisance cardiaque chez Mme X"
                autoFocus
                className="mt-1 w-full px-2.5 py-1.5 rounded-input border border-input bg-input-background text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Vignette clinique (min 20 caractères)
              </span>
              <textarea
                value={form.vignette}
                onChange={(e) => setForm({ ...form, vignette: e.target.value })}
                placeholder="Énoncé clinique partagé par toutes les questions de la série"
                className="mt-1 w-full min-h-[160px] px-2.5 py-1.5 rounded-input border border-input bg-input-background text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                {(form.vignette || '').trim().length} / min 20 caractères
              </span>
            </label>
            {formError && (
              <div className="text-xs text-danger-700 dark:text-danger-500">{formError}</div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 p-4 border-t border-border">
          {step === 'select' ? (
            <>
              <span className="text-xs text-muted-foreground">
                {orderedSelected.length} sélectionnée(s)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-input text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Annuler
                </button>
                <button
                  onClick={goToForm}
                  disabled={orderedSelected.length < 2}
                  className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600"
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
                className="px-4 py-2 rounded-input text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Retour
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-input text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Annuler
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
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
                className="bg-card border border-border rounded-card p-5 space-y-4"
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
