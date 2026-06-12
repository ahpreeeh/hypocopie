import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, History, CheckCircle2, XCircle, HelpCircle, Trash2, Clock,
  Play, RotateCcw, ChevronRight, BookOpen,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, KpiCard, MiniSparkline, PageBreadcrumb } from '../components/design-primitives';
import { formatScoreNumber, humanizeError, scoreGradientClass, scoreTextClass } from '../ui-feedback';

interface SessionSummary {
  id: string;
  annaleId: string;
  annaleTitle: string;
  annaleSubject: string;
  annaleYear?: number;
  annaleSession?: string;
  mode: 'exam' | 'libre';
  submittedAt: string;
  durationSec?: number;
  score: {
    juste: number;
    faux?: number;
    partiel?: number;
    totalNotees: number;
    nonComptees: number;
    percentage: number | null;
    totalQuestions: number;
    points?: number;
    maxPoints?: number;
  };
  scoreRecalculated?: boolean;
  scoreWarning?: string;
}

interface SessionDetail extends SessionSummary {
  startedAt: string;
  answers: Record<string, string[] | string | null>;
  finalScore: SessionSummary['score'];
  details: Array<{
    qid: string;
    questionType: 'QRU' | 'QRM' | 'QROC' | 'ZONE';
    text: string;
    image?: string | null;
    seriesId?: string | null;
    seriesFormat?: 'DP' | 'KFP' | null;
    seriesPosition?: number | null;
    userAnswer: string[] | string | null;
    result: 'juste' | 'partiel' | 'faux' | 'non-comptee';
    scoreValue?: number;
    maxScore?: number;
    mistakes?: number | null;
    missedCorrect?: string[];
    wrongSelected?: string[];
    scoreReason?: string | null;
    options?: Array<{ id: string; text: string; correct: boolean }> | null;
    expectedAnswer?: string | null;
    correctionText?: string | null;
    correctedImage?: string | null;
  }>;
}

function scorePoints(score: SessionSummary['score']): number {
  return typeof score.points === 'number' ? score.points : score.juste;
}

function scoreMaxPoints(score: SessionSummary['score']): number {
  return typeof score.maxPoints === 'number' ? score.maxPoints : score.totalNotees;
}

function detailMistakeLabel(detail: SessionDetail['details'][number]): string | null {
  if (detail.result === 'non-comptee') return detail.scoreReason || null;
  const missed = detail.missedCorrect?.length || 0;
  const wrong = detail.wrongSelected?.length || 0;
  const parts = [];
  if (missed > 0) parts.push(`${missed} oubli${missed > 1 ? 's' : ''}`);
  if (wrong > 0) parts.push(`${wrong} coche${wrong > 1 ? 's' : ''} fausse${wrong > 1 ? 's' : ''}`);
  return parts.length ? `${parts.join(', ')}.` : null;
}

function detailScoreConfig(detail: SessionDetail['details'][number]) {
  const score = typeof detail.scoreValue === 'number' ? detail.scoreValue : null;
  const max = typeof detail.maxScore === 'number' ? detail.maxScore : 0;
  if (max === 0 || detail.result === 'non-comptee') {
    return { label: 'A revoir', icon: HelpCircle, color: 'text-muted-foreground', ring: 'ring-muted-foreground/20', badge: 'NC', badgeClass: 'bg-muted text-muted-foreground' };
  }
  if (score === 1) {
    return { label: '1 point', icon: CheckCircle2, color: 'text-success-700 dark:text-success-500', ring: 'ring-success-500/30', badge: '1', badgeClass: 'bg-success-700 text-white' };
  }
  if (score === 0.5) {
    return { label: '0.5 point', icon: HelpCircle, color: 'text-warn-700 dark:text-warn-500', ring: 'ring-warn-500/30', badge: '0.5', badgeClass: 'bg-warn-500 text-white' };
  }
  if (score === 0.2) {
    return { label: '0.2 point', icon: HelpCircle, color: 'text-warn-700 dark:text-warn-500', ring: 'ring-warn-500/30', badge: '0.2', badgeClass: 'bg-warn-500 text-white' };
  }
  return { label: '0 point', icon: XCircle, color: 'text-danger-700 dark:text-danger-500', ring: 'ring-danger-500/30', badge: '0', badgeClass: 'bg-danger-700 text-white' };
}

// ═════════════════════════════════════════════════════════════════════
// LISTE — /entrainement/historique
// ═════════════════════════════════════════════════════════════════════

export function HistoriquePage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const reload = async () => {
    try {
      const r = await fetch('/api/exam-sessions');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: SessionSummary[] = await r.json();
      setSessions(data);
    } catch (e: any) {
      const message = humanizeError(e);
      setError(message);
      toast.error('Chargement de l historique impossible');
    }
  };

  useEffect(() => { reload(); }, []);

  const handleDelete = async (sid: string) => {
    if (!confirm('Supprimer cette session de l\'historique ?')) return;
    try {
      const r = await fetch(`/api/exam-sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reload();
      toast.success('Session supprimee');
    } catch (e: any) {
      toast.error(`Suppression impossible : ${humanizeError(e)}`);
    }
  };

  // Regroupement par annaleId
  const grouped = useMemo(() => {
    if (!sessions) return [];
    const map = new Map<string, SessionSummary[]>();
    for (const s of sessions) {
      const key = s.annaleId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aLatest = a[1][0]?.submittedAt || '';
      const bLatest = b[1][0]?.submittedAt || '';
      return bLatest.localeCompare(aLatest);
    });
  }, [sessions]);

  const sessionStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const scored = sessions
      .map((session) => session.score.percentage)
      .filter((score): score is number => typeof score === 'number');
    const averageScore = scored.length
      ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
      : null;
    const totalDuration = sessions.reduce((sum, session) => sum + (session.durationSec || 0), 0);
    const annalesCount = new Set(sessions.map((session) => session.annaleId)).size;
    return { sessionsCount: sessions.length, annalesCount, averageScore, totalDuration };
  }, [sessions]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            to="/entrainement"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} /> Annales
          </Link>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-[22px] font-[650] tracking-[-0.015em] text-foreground">
              <History size={20} className="text-brand-700" />
              Historique des sessions
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Retrouve toutes tes copies (mode examen et mode libre).
            </p>
          </div>
        </div>
      </header>

      <PageBreadcrumb items={[
        { label: 'Entrainement', to: '/entrainement' },
        { label: 'Historique' },
      ]} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 rounded-input bg-danger-50 dark:bg-danger-950/30 text-danger-700 dark:text-danger-500 mb-6">
            Erreur : {error}
          </div>
        )}

        {!sessions && !error && (
          <HistoriqueListSkeleton />
        )}

        {sessionStats && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <KpiCard icon={History} label="Sessions" value={sessionStats.sessionsCount} tone="brand" />
            <KpiCard icon={BookOpen} label="Annales" value={sessionStats.annalesCount} />
            <KpiCard icon={CheckCircle2} label="Moyenne" value={sessionStats.averageScore === null ? '-' : `${sessionStats.averageScore}%`} tone="success" />
            <KpiCard icon={Clock} label="Temps total" value={formatDuration(sessionStats.totalDuration)} tone="warn" />
          </div>
        )}

        {sessions && sessions.length === 0 && (
          <EmptyState
            icon={History}
            title="Aucune session encore"
            description="Soumets une annale en mode examen ou libre pour retrouver ici ta copie, ton score et les corrections."
            action={
              <Link
                to="/entrainement"
                className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-card)] transition-colors hover:bg-brand-700"
              >
                <Play size={16} />
                Demarrer une annale
              </Link>
            }
          />
        )}

        {grouped.map(([annaleId, list]) => (
          <section key={annaleId} className="mb-8">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-[12px] font-[650] uppercase tracking-[0.09em] text-muted-foreground">
                  {list[0].annaleTitle}
                  <span className="text-muted-foreground/70 font-normal"> ({list.length} session{list.length > 1 ? 's' : ''})</span>
                </h2>
                <MiniSparkline
                  values={[...list]
                    .reverse()
                    .map((session) => session.score.percentage)
                    .filter((score): score is number => typeof score === 'number')}
                  className="mt-1"
                />
              </div>
              <Link
                to={`/entrainement/${annaleId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <Play size={12} /> Refaire l'annale
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((s) => {
                const pct = s.score.percentage;
                const colorClass = scoreTextClass(pct);
                const points = scorePoints(s.score);
                const maxPoints = scoreMaxPoints(s.score);

                return (
                  <div
                    key={s.id}
                    className="group relative rounded-card border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand-100"
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      className="absolute right-2 top-2 rounded-input p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-danger-50 hover:text-danger-700 group-hover:opacity-100 dark:hover:bg-danger-950/40"
                      title="Supprimer cette session"
                    >
                      <Trash2 size={14} />
                    </button>
                    <Link
                      to={`/entrainement/historique/${s.id}`}
                      className="block"
                    >
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-[650] uppercase tracking-[0.09em]">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                          s.mode === 'exam'
                            ? 'border border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700/40 dark:bg-brand-950/40 dark:text-brand-100'
                            : 'border border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700/40 dark:bg-warn-950/40 dark:text-warn-100'
                        }`}>
                          {s.mode === 'exam' ? 'EXAMEN' : 'LIBRE'}
                        </span>
                      </div>
                      <div className={`text-2xl font-[650] ${colorClass}`}>
                        {formatScoreNumber(points)} / {formatScoreNumber(maxPoints)}
                        {pct !== null && <span className="text-sm font-medium ml-2 opacity-70">{pct}%</span>}
                      </div>
                      {(s.score.partiel || 0) > 0 && (
                        <div className="text-xs text-warn-700 dark:text-warn-500 mt-0.5">
                          {s.score.partiel} partielle{s.score.partiel && s.score.partiel > 1 ? 's' : ''}
                        </div>
                      )}
                      {s.score.nonComptees > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          + {s.score.nonComptees} à revoir
                        </div>
                      )}
                      {s.scoreWarning && (
                        <div className="mt-2 rounded-md bg-warn-50 px-2 py-1 text-[11px] text-warn-700 dark:bg-warn-950/30 dark:text-warn-100">
                          {s.scoreWarning}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(s.submittedAt)}</span>
                        {s.durationSec !== undefined && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="inline-flex items-center gap-0.5"><Clock size={11} /> {formatDuration(s.durationSec)}</span>
                          </>
                        )}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function HistoriqueListSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="space-y-3 rounded-card border border-border bg-card p-4"
              >
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-44" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoriqueDetailSkeleton() {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Skeleton className="h-5 w-24" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-56 w-full rounded-card" />
        <Skeleton className="h-6 w-48" />
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-40 w-full rounded-card" />
        ))}
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// DÉTAIL — /entrainement/historique/:sessionId
// ═════════════════════════════════════════════════════════════════════

export function HistoriqueDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/exam-sessions/${encodeURIComponent(sessionId)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: SessionDetail = await r.json();
        if (!cancelled) setSession(data);
      } catch (e: any) {
        if (!cancelled) {
          const message = humanizeError(e);
          setError(message);
          toast.error('Chargement de la session impossible');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleDelete = async () => {
    if (!session) return;
    if (!confirm('Supprimer cette session de l\'historique ?')) return;
    try {
      await fetch(`/api/exam-sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      toast.success('Session supprimee');
      navigate('/entrainement/historique');
    } catch (e: any) {
      toast.error(`Suppression impossible : ${humanizeError(e)}`);
    }
  };

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background p-8">
        <div className="text-center">
          <p className="mb-3 text-sm text-danger-700 dark:text-danger-500">Erreur : {error}</p>
          <Link to="/entrainement/historique" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-500">Retour à l'historique</Link>
        </div>
      </div>
    );
  }
  if (!session) {
    return <HistoriqueDetailSkeleton />;
  }

  const fs = session.finalScore;
  const scoreGradient = scoreGradientClass(fs.percentage);
  const points = scorePoints(fs);
  const maxPoints = scoreMaxPoints(fs);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4 flex-wrap">
          <Link
            to="/entrainement/historique"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} /> Historique
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-base font-[650] text-foreground">{session.annaleTitle}</h1>
            <p className="text-xs text-muted-foreground">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-[650] mr-2 ${
                session.mode === 'exam'
                  ? 'border border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700/40 dark:bg-brand-950/40 dark:text-brand-100'
                  : 'border border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700/40 dark:bg-warn-950/40 dark:text-warn-100'
              }`}>
                {session.mode === 'exam' ? 'EXAMEN' : 'LIBRE'}
              </span>
              {formatDate(session.submittedAt)}
              {session.durationSec !== undefined && (
                <> · <Clock size={11} className="inline" /> {formatDuration(session.durationSec)}</>
              )}
            </p>
          </div>
          <Link
            to={`/entrainement/${session.annaleId}`}
            className="flex items-center gap-1.5 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <RotateCcw size={14} /> Refaire l'annale
          </Link>
          <button
            onClick={handleDelete}
            className="rounded-input p-2 text-muted-foreground transition-colors hover:bg-danger-50 hover:text-danger-700 dark:hover:bg-danger-950/40"
            title="Supprimer cette session"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Score */}
        <div className={`bg-gradient-to-br ${scoreGradient} text-white rounded-card p-10 mb-8 text-center shadow-lg`}>
          <div className="text-xs font-medium uppercase tracking-wider opacity-80 mb-2">Ta copie</div>
          <div className="text-7xl font-medium mb-2">
            {formatScoreNumber(points)} / {formatScoreNumber(maxPoints)}
          </div>
          {fs.percentage !== null && (
            <div className="text-2xl opacity-90">{fs.percentage}%</div>
          )}
          {fs.nonComptees > 0 && (
            <div className="mt-3 text-sm opacity-90">
              + {fs.nonComptees} QROC/Zone à revoir manuellement
            </div>
          )}
        </div>

        {session.scoreWarning && (
          <div className="mb-6 rounded-input border border-warn-100 bg-warn-50 px-4 py-3 text-sm text-warn-950 dark:border-warn-700/50 dark:bg-warn-950/30 dark:text-warn-100">
            {session.scoreWarning}
          </div>
        )}

        {/* Détail des questions */}
        <h2 className="text-lg font-medium mb-4 text-foreground">
          Détail des questions
        </h2>
        <div className="space-y-4">
          {session.details.map((d, i) => (
            <SessionQuestionCard
              key={d.qid}
              detail={d}
              index={i}
              annaleId={session.annaleId}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function SessionQuestionCard({
  detail: d, index, annaleId,
}: { detail: SessionDetail['details'][number]; index: number; annaleId: string; }) {
  const scoreCfg = detailScoreConfig(d);
  const Icon = scoreCfg.icon;
  const mistakeLabel = detailMistakeLabel(d);

  return (
    <div className={`rounded-card border border-border bg-card ring-2 ${scoreCfg.ring} p-5 shadow-sm`}>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <Icon size={16} className={scoreCfg.color} />
        <span className={`font-medium uppercase tracking-wider ${scoreCfg.color}`}>{scoreCfg.label}</span>
        <span className={`rounded-md px-2 py-1 font-mono text-xs font-medium ${scoreCfg.badgeClass}`}>
          {scoreCfg.badge}
        </span>
        {mistakeLabel && <span className="text-muted-foreground">{mistakeLabel}</span>}
        <span className="text-muted-foreground/60">·</span>
        <span className="font-mono text-muted-foreground">Q{index + 1}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground uppercase">{d.questionType}</span>
        {d.seriesId && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{d.seriesFormat || 'DP'} Q{d.seriesPosition}</span>
          </>
        )}
      </div>

      <p className="text-base font-medium mb-3 whitespace-pre-wrap text-foreground leading-relaxed">
        {d.text}
      </p>

      {d.image && (
        <img
          src={`/api/annales/${annaleId}/img/${d.image}`}
          alt=""
          className="rounded-input border border-border mb-3 max-w-full max-h-[400px] object-contain"
        />
      )}

      {d.options && (
        <div className="space-y-1.5 mb-3">
          {d.options.map((o) => {
            const userPicked = Array.isArray(d.userAnswer) && d.userAnswer.includes(o.id);
            return (
              <div
                key={o.id}
                className={`flex items-start gap-2 p-2 rounded-input text-sm border ${
                  o.correct
                    ? 'bg-success-50 dark:bg-success-950/30 border-success-100 dark:border-success-700/50 text-success-950 dark:text-success-100'
                    : userPicked
                    ? 'bg-danger-50 dark:bg-danger-950/30 border-danger-100 dark:border-danger-700/50 text-danger-950 dark:text-danger-100'
                    : 'border-border bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs font-medium ${
                  o.correct ? 'bg-success-700 text-white' : userPicked ? 'bg-danger-700 text-white' : 'bg-muted text-muted-foreground'
                }`}>
                  {o.id}
                </span>
                <span className="flex-1 leading-relaxed">{o.text}</span>
                {o.correct && <CheckCircle2 size={14} className="text-success-700 dark:text-success-500 shrink-0 mt-0.5" />}
                {userPicked && !o.correct && <XCircle size={14} className="text-danger-700 dark:text-danger-500 shrink-0 mt-0.5" />}
              </div>
            );
          })}
        </div>
      )}

      {(d.questionType === 'QROC' || d.questionType === 'ZONE') && (
        <div className="space-y-2 mb-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">Ta réponse</div>
            <div className="whitespace-pre-wrap rounded-input border border-border bg-muted/60 p-2 text-sm">
              {typeof d.userAnswer === 'string' && d.userAnswer
                ? d.userAnswer
                : <span className="italic text-muted-foreground">Pas de réponse</span>}
            </div>
          </div>
          {d.expectedAnswer && (
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-success-700 dark:text-success-500 mb-1.5">Réponse officielle</div>
              <div className="text-sm bg-success-50 dark:bg-success-950/30 p-2 rounded-input border border-success-100 dark:border-success-700/50 whitespace-pre-wrap text-success-950 dark:text-success-100">
                {d.expectedAnswer}
              </div>
            </div>
          )}
        </div>
      )}

      {d.correctionText ? (
        <details className="text-sm group">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground select-none flex items-center gap-1.5">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Correction détaillée
          </summary>
          <div className="ml-5 mt-2 whitespace-pre-wrap rounded-input border border-border bg-muted/60 p-3 leading-relaxed text-foreground">
            {d.correctionText}
          </div>
        </details>
      ) : (
        <div className="mt-2 text-xs italic text-muted-foreground px-3 py-2 rounded-input bg-muted/50 border border-dashed border-border">
          Pas de commentaire de correction écrit dans le PDF source. Réfère-toi aux bonnes réponses cochées + un manuel/livre de cours.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return format(new Date(iso), 'dd MMM yyyy à HH:mm', { locale: fr });
  } catch {
    return iso;
  }
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
