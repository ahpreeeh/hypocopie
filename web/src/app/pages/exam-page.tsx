import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, CheckCircle2, XCircle, HelpCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, BookOpen, Send, RotateCcw, Check, Circle, FileText,
  Sparkles, Maximize2, Minimize2, Flag, Menu, Keyboard, Clipboard, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { getStoredExamMode, type ExamMode } from './annales-list';
import { Skeleton } from '../components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { DisabledHint } from '../components/design-primitives';
import { formatScoreNumber, humanizeError, scoreGradientClass } from '../ui-feedback';
import { ReportIssueModal } from '../components/report-issue-modal';
import { QuestionEditorModal, type EditableQuestion } from '../components/question-editor-modal';

// ─────────────────────────────────────────────────────────────────────
// Types des annales
// ─────────────────────────────────────────────────────────────────────

type QuestionType = 'QRU' | 'QRM' | 'QROC' | 'ZONE';
type SeriesFormat = 'DP' | 'KFP';

interface PlayOption { id: string; text: string; }

interface PlayQuestion {
  id: string;
  questionType: QuestionType;
  text: string;
  image?: string | null;
  options?: PlayOption[];
  seriesId?: string | null;
  seriesFormat?: SeriesFormat | null;
  seriesPosition?: number | null;
  seriesTotal?: number | null;
  vignette?: string | null;
  customTitle?: string | null;
}

interface PlayAnnale {
  id: string;
  title: string;
  subject: string;
  year?: number;
  session?: string;
  questions: PlayQuestion[];
}

type AnswerValue = string[] | string | null;

interface GradeDetail {
  qid: string;
  questionType: QuestionType;
  text: string;
  image?: string | null;
  seriesId?: string | null;
  seriesFormat?: SeriesFormat | null;
  seriesPosition?: number | null;
  userAnswer: AnswerValue;
  result: 'juste' | 'partiel' | 'faux' | 'non-comptee';
  scoreValue?: number;
  maxScore?: number;
  mistakes?: number | null;
  missedCorrect?: string[];
  wrongSelected?: string[];
  scoreReason?: string | null;
  options?: Array<{ id: string; text: string; correct: boolean }> | null;
  answerSource?: 'source' | 'ai' | string | null;
  expectedAnswer?: string | null;
  correctionText?: string | null;
  correctedImage?: string | null;
}

interface GradeResult {
  finalScore: {
    juste: number; partiel?: number; faux: number; totalNotees: number; nonComptees: number;
    totalQuestions: number; percentage: number | null; points?: number; maxPoints?: number;
  };
  details: GradeDetail[];
}

const EXAM_DRAFT_VERSION = 2;

function isExamMode(value: unknown): value is ExamMode {
  return value === 'exam' || value === 'libre';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function scoreValueOf(detail: GradeDetail): number | null {
  return typeof detail.scoreValue === 'number' ? detail.scoreValue : null;
}

function maxScoreOf(detail: GradeDetail): number {
  return typeof detail.maxScore === 'number' ? detail.maxScore : 0;
}

function finalPoints(score: GradeResult['finalScore']): number {
  return typeof score.points === 'number' ? score.points : score.juste;
}

function finalMaxPoints(score: GradeResult['finalScore']): number {
  return typeof score.maxPoints === 'number' ? score.maxPoints : score.totalNotees;
}

function scoreMistakeLabel(detail: GradeDetail): string | null {
  if (detail.result === 'non-comptee') return detail.scoreReason || null;
  const missed = detail.missedCorrect?.length || 0;
  const wrong = detail.wrongSelected?.length || 0;
  const parts = [];
  if (missed > 0) parts.push(`${missed} oubli${missed > 1 ? 's' : ''}`);
  if (wrong > 0) parts.push(`${wrong} coche${wrong > 1 ? 's' : ''} fausse${wrong > 1 ? 's' : ''}`);
  if (parts.length === 0) return null;
  return `${parts.join(', ')}.`;
}

function scoreVisual(detail: GradeDetail) {
  const score = scoreValueOf(detail);
  const max = maxScoreOf(detail);
  if (max === 0 || detail.result === 'non-comptee') {
    return {
      label: 'A comparer',
      badge: 'NC',
      icon: HelpCircle,
      ring: 'ring-neutral-400/30',
      accent: 'text-neutral-600 dark:text-neutral-300',
      badgeClass: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
      bg: 'bg-white dark:bg-neutral-900',
    };
  }
  if (score === 1) {
    return {
      label: '1 point',
      badge: '1',
      icon: CheckCircle2,
      ring: 'ring-green-500/30',
      accent: 'text-green-700 dark:text-green-400',
      badgeClass: 'bg-green-600 text-white',
      bg: 'bg-white dark:bg-neutral-900',
    };
  }
  if (score === 0.5) {
    return {
      label: '0.5 point',
      badge: '0.5',
      icon: HelpCircle,
      ring: 'ring-amber-500/30',
      accent: 'text-amber-700 dark:text-amber-400',
      badgeClass: 'bg-amber-500 text-white',
      bg: 'bg-white dark:bg-neutral-900',
    };
  }
  if (score === 0.2) {
    return {
      label: '0.2 point',
      badge: '0.2',
      icon: AlertTriangle,
      ring: 'ring-orange-500/30',
      accent: 'text-orange-700 dark:text-orange-400',
      badgeClass: 'bg-orange-500 text-white',
      bg: 'bg-white dark:bg-neutral-900',
    };
  }
  return {
    label: '0 point',
    badge: '0',
    icon: XCircle,
    ring: 'ring-red-500/30',
    accent: 'text-red-700 dark:text-red-400',
    badgeClass: 'bg-red-600 text-white',
    bg: 'bg-white dark:bg-neutral-900',
  };
}

function shouldIgnoreShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

// ─────────────────────────────────────────────────────────────────────
// Calcul des ajouts incrémentaux DP/KFP (copié de data-context.tsx)
// ─────────────────────────────────────────────────────────────────────

interface VignetteAddition { qid: string; position: number; addition: string; }
interface SeriesVignetteInfo { baseVignette: string; additions: VignetteAddition[]; }

function computeSeriesVignettes(questions: PlayQuestion[]): Map<string, SeriesVignetteInfo> {
  const groups = new Map<string, PlayQuestion[]>();
  for (const q of questions) {
    if (!q.seriesId) continue;
    if (!groups.has(q.seriesId)) groups.set(q.seriesId, []);
    groups.get(q.seriesId)!.push(q);
  }
  const result = new Map<string, SeriesVignetteInfo>();
  for (const [seriesId, sQs] of groups.entries()) {
    const sorted = [...sQs].sort((a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0));
    let baseVignette = '';
    let prev = '';
    const additions: VignetteAddition[] = [];
    for (const q of sorted) {
      const v = (q.vignette || '').trim();
      if (!v) continue;
      if (!baseVignette) { baseVignette = v; prev = v; continue; }
      let addition = '';
      if (v.startsWith(prev)) addition = v.slice(prev.length).trim();
      else {
        const np = prev.replace(/\s+/g, ' ').trim();
        const nc = v.replace(/\s+/g, ' ').trim();
        addition = nc.startsWith(np) ? nc.slice(np.length).trim() : v;
      }
      if (addition) additions.push({ qid: q.id, position: q.seriesPosition || 0, addition });
      prev = v;
    }
    if (baseVignette) result.set(seriesId, { baseVignette, additions });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Composant : Bloc vignette progressive
// ─────────────────────────────────────────────────────────────────────

function ClinicalCase({
  info, currentQid, currentPosition, isSubmitted, customTitle,
}: {
  info: SeriesVignetteInfo; currentQid: string; currentPosition: number;
  isSubmitted: boolean; customTitle?: string | null;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
      <div className="px-5 py-3 bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
        <BookOpen size={15} className="text-indigo-600 dark:text-indigo-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
          Cas clinique
        </span>
        {customTitle && (
          <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
            — {customTitle}
          </span>
        )}
      </div>
      <div className="p-5 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
        <p className="whitespace-pre-wrap">{info.baseVignette}</p>
        {info.additions.map((add) => {
          if (!isSubmitted && add.position > currentPosition) return null;
          const isCurrent = add.qid === currentQid;
          if (isCurrent && !isSubmitted) {
            return (
              <div key={add.qid} className="relative mt-4 -mx-5 px-5 py-4 bg-indigo-50 dark:bg-indigo-950/40 border-y border-indigo-200 dark:border-indigo-800/50">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500"></div>
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                  </span>
                  Nouvelle information (Q{add.position})
                </span>
                <p className="whitespace-pre-wrap font-medium text-indigo-950 dark:text-indigo-100">{add.addition}</p>
              </div>
            );
          }
          return (
            <div key={add.qid} className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 block mb-1">
                Information Q{add.position}
              </span>
              <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{add.addition}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────

export function ExamPage() {
  const { annaleId } = useParams<{ annaleId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Deep-link : si l'URL contient ?q=<questionId>, on saute à cette question
  // après chargement. Utilisé par /admin/corrections pour amener directement
  // à la question signalée.
  const targetQuestionId = searchParams.get('q');

  const [annale, setAnnale] = useState<PlayAnnale | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  // Ref miroir d'elapsedSec : lu au moment de la sauvegarde du draft sans
  // faire partie des deps de l'effet de save (sinon l'effet se redéclencherait
  // chaque seconde et réécrirait tout le draft en localStorage).
  const elapsedSecRef = useRef(0);
  useEffect(() => { elapsedSecRef.current = elapsedSec; }, [elapsedSec]);
  const [submitted, setSubmitted] = useState<GradeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  // Mode lu une seule fois au chargement (figé pendant la session)
  const [examMode, setExamMode] = useState<ExamMode>(() => getStoredExamMode());
  // Corrections inline pour le mode libre (qid → détail)
  const [perQuestionDetails, setPerQuestionDetails] = useState<Record<string, GradeDetail>>({});
  const [validatingQid, setValidatingQid] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('hypocampus_exam_focus_mode') === '1');
  const [examSidebarCompact, setExamSidebarCompact] = useState(() => localStorage.getItem('hypocampus_exam_sidebar_compact') === '1');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorQuestion, setEditorQuestion] = useState<EditableQuestion | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  // Ref vers le container scrollable principal — permet de remonter en haut
  // de manière fluide quand on change de question (sinon on reste en bas
  // après avoir lu la correction de la question précédente).
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(() => {
    if (!annaleId) return new Set();
    const raw = localStorage.getItem(`exam_marks_${annaleId}`);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
    } catch {
      return new Set();
    }
  });

  const storageKey = annaleId ? `exam_${annaleId}` : null;
  const marksStorageKey = annaleId ? `exam_marks_${annaleId}` : null;

  useEffect(() => {
    if (!annaleId) return;
    let cancelled = false;
    setDraftReady(false);
    setHasRestoredDraft(false);
    setLastSavedAt(null);
    (async () => {
      try {
        const r = await fetch(`/api/annales/${encodeURIComponent(annaleId)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: PlayAnnale = await r.json();
        if (cancelled) return;

        let restoredAnswers: Record<string, AnswerValue> = {};
        let restoredDetails: Record<string, GradeDetail> = {};
        let restoredIndex = 0;
        let restoredElapsed = 0;
        let restoredAt: string | null = null;
        let restoredMode = getStoredExamMode();
        let restoredDraft = false;

        if (storageKey) {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            try {
              const saved = JSON.parse(raw);
              if (isRecord(saved) && saved.annaleId === annaleId) {
                restoredAnswers = isRecord(saved.answers)
                  ? saved.answers as Record<string, AnswerValue>
                  : {};
                restoredDetails = isRecord(saved.perQuestionDetails)
                  ? saved.perQuestionDetails as Record<string, GradeDetail>
                  : {};
                restoredIndex = Math.min(
                  Math.max(0, Math.floor(readNumber(saved.currentIndex, 0))),
                  Math.max(0, data.questions.length - 1),
                );
                restoredElapsed = Math.max(0, Math.floor(readNumber(saved.elapsedSec, 0)));
                restoredAt = readString(saved.updatedAt);
                restoredMode = isExamMode(saved.examMode) ? saved.examMode : restoredMode;
                restoredDraft =
                  Object.values(restoredAnswers).some(isAnswered) ||
                  Object.keys(restoredDetails).length > 0 ||
                  restoredIndex > 0 ||
                  restoredElapsed > 0;
              }
            } catch {}
          }
        }

        setAnnale(data);
        setAnswers(restoredAnswers);
        // Deep-link ?q=<qid> a priorité sur l'index restauré du draft
        let initialIndex = restoredIndex;
        if (targetQuestionId && Array.isArray(data?.questions)) {
          const targetIdx = data.questions.findIndex((q: any) => q?.id === targetQuestionId);
          if (targetIdx >= 0) initialIndex = targetIdx;
        }
        setCurrentIndex(initialIndex);
        setElapsedSec(restoredElapsed);
        setStartedAt(Date.now() - restoredElapsed * 1000);
        setExamMode(restoredMode);
        setPerQuestionDetails(restoredDetails);
        setLastSavedAt(restoredAt);
        setHasRestoredDraft(restoredDraft);
        setDraftReady(true);
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [annaleId, storageKey]);

  useEffect(() => {
    if (!marksStorageKey) {
      setMarkedForReview(new Set());
      return;
    }

    const raw = localStorage.getItem(marksStorageKey);
    if (!raw) {
      setMarkedForReview(new Set());
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      setMarkedForReview(Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set());
    } catch {
      setMarkedForReview(new Set());
    }
  }, [marksStorageKey]);

  useEffect(() => {
    if (submitted) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt, submitted]);

  useEffect(() => {
    if (!storageKey || submitted || !draftReady) return;
    const hasDraftContent =
      Object.values(answers).some(isAnswered) ||
      Object.keys(perQuestionDetails).length > 0 ||
      currentIndex > 0 ||
      hasRestoredDraft;
    if (!hasDraftContent) {
      localStorage.removeItem(storageKey);
      setLastSavedAt(null);
      return;
    }
    const updatedAt = new Date().toISOString();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: EXAM_DRAFT_VERSION,
        annaleId,
        answers,
        currentIndex,
        examMode,
        perQuestionDetails,
        elapsedSec: elapsedSecRef.current,
        updatedAt,
      }),
    );
    setLastSavedAt(updatedAt);
  }, [annaleId, storageKey, answers, currentIndex, submitted, perQuestionDetails, examMode, draftReady, hasRestoredDraft]);

  // Flush draft à la fermeture d'onglet / passage en background : sécurise
  // elapsedSec qui n'est plus dans les deps de l'effet de save (sinon écriture
  // chaque seconde). Les réponses sont déjà sauvées à chaque interaction ; ce
  // flush rattrape uniquement le temps écoulé "silencieux".
  useEffect(() => {
    if (!storageKey || submitted) return;
    const flush = () => {
      if (document.visibilityState !== 'hidden' && !window.event) return;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const draft = JSON.parse(raw);
        draft.elapsedSec = elapsedSecRef.current;
        draft.updatedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        // Best effort, ne pas bloquer la fermeture
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [storageKey, submitted]);

  const seriesVignettes = useMemo(
    () => (annale ? computeSeriesVignettes(annale.questions) : new Map<string, SeriesVignetteInfo>()),
    [annale],
  );

  // Quand on change de question, remonter en haut du container central de
  // manière fluide (sinon on reste en bas après avoir lu la correction).
  // Respecte la préférence système "réduire les animations".
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // requestAnimationFrame : attendre que le nouveau contenu de question
    // soit rendu avant de lancer le scroll, sinon l'animation peut être
    // interrompue par le re-layout.
    const raf = requestAnimationFrame(() => {
      container.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [currentIndex]);

  // Sauvegarde automatique de la session dans l'historique
  // ⚠️ Doit rester AVANT tout early return pour respecter les rules of hooks
  const saveSession = useCallback(async (result: GradeResult) => {
    if (!annaleId) return;
    try {
      await fetch('/api/exam-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annaleId,
          mode: examMode,
          startedAt: new Date(startedAt).toISOString(),
          submittedAt: new Date().toISOString(),
          durationSec: elapsedSec,
          answers,
          finalScore: result.finalScore,
          details: result.details,
        }),
      });
    } catch (e) {
      console.warn('[exam] Echec sauvegarde session:', e);
    }
  }, [annaleId, examMode, startedAt, elapsedSec, answers]);

  const toggleFocusMode = () => {
    setFocusMode((prev) => {
      const next = !prev;
      localStorage.setItem('hypocampus_exam_focus_mode', next ? '1' : '0');
      return next;
    });
  };

  const toggleExamSidebarCompact = () => {
    setExamSidebarCompact((prev) => {
      const next = !prev;
      localStorage.setItem('hypocampus_exam_sidebar_compact', next ? '1' : '0');
      return next;
    });
  };

  // Copie de la question vers le presse-papier (pour coller dans une IA externe).
  // includeVignette=true → tout (vignette cumulative + énoncé + propositions).
  // includeVignette=false → énoncé + propositions seulement.
  const buildQuestionPlainText = useCallback((includeVignette: boolean): string => {
    if (!annale) return '';
    const q = annale.questions[currentIndex];
    if (!q) return '';
    const parts: string[] = [];
    if (includeVignette && q.seriesId) {
      const info = seriesVignettes.get(q.seriesId);
      if (info) {
        let vignetteText = info.baseVignette;
        const adds = info.additions
          .filter((a) => a.position <= (q.seriesPosition || 0))
          .map((a) => a.addition);
        if (adds.length > 0) vignetteText += '\n\n' + adds.join('\n\n');
        parts.push(`Cas clinique :\n${vignetteText}`);
      }
    }
    const typeLabel = q.questionType ? ` (${q.questionType})` : '';
    parts.push(`Question${typeLabel} :\n${q.text}`);
    if (q.options && q.options.length > 0) {
      const optsStr = q.options.map((o) => `${o.id}. ${o.text}`).join('\n');
      parts.push(`Propositions :\n${optsStr}`);
    }
    return parts.join('\n\n');
  }, [annale, currentIndex, seriesVignettes]);

  const handleCopyQuestion = useCallback(async (includeVignette: boolean) => {
    const text = buildQuestionPlainText(includeVignette);
    if (!text) {
      toast.error('Rien à copier');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(includeVignette ? 'Copié (avec vignette)' : 'Copié (sans vignette)');
    } catch {
      toast.error('Echec de la copie — vérifie les permissions clipboard');
    }
  }, [buildQuestionPlainText]);

  // Raccourci : éditer la question courante directement depuis exam-page
  // sans passer par /admin/corrections. Charge le raw via l'endpoint admin
  // (qui inclut les `correct`, `expectedAnswer`, `correctionText` que le mode
  // play strip).
  const handleEditCurrentQuestion = useCallback(async () => {
    if (!annaleId || !annale) return;
    const q = annale.questions[currentIndex];
    if (!q) return;
    setEditorOpen(true);
    setEditorLoading(true);
    setEditorQuestion(null);
    try {
      const res = await fetch(
        `/api/admin/annales/${encodeURIComponent(annaleId)}/questions/${encodeURIComponent(q.id)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      setEditorQuestion(data.question as EditableQuestion);
    } catch (e: any) {
      toast.error(`Impossible de charger la question : ${e?.message || e}`);
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  }, [annale, annaleId, currentIndex]);

  // Après PATCH question depuis exam-page : recharger l'annale (cache serveur
  // est invalidé, et le mode play strip change). Plus simple : refetch.
  const handleAfterEdit = useCallback(async () => {
    if (!annaleId) return;
    try {
      const res = await fetch(`/api/annales/${encodeURIComponent(annaleId)}`);
      if (res.ok) {
        const data = await res.json();
        setAnnale(data);
      }
    } catch {
      // Pas grave, le user peut F5
    }
  }, [annaleId]);

  const toggleMarkedForReview = (questionId: string) => {
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }

      if (marksStorageKey) {
        localStorage.setItem(marksStorageKey, JSON.stringify([...next]));
      }
      return next;
    });
  };

  useEffect(() => {
    if (loadError) toast.error(`Chargement impossible : ${humanizeError(loadError)}`);
  }, [loadError]);

  const validateOneQuestion = useCallback(async (qid: string) => {
    if (!annaleId) return;
    setValidatingQid(qid);
    try {
      const r = await fetch(`/api/annales/${encodeURIComponent(annaleId)}/grade-one`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qid, answer: answers[qid] ?? null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const detail: GradeDetail = await r.json();
      setPerQuestionDetails(prev => ({ ...prev, [qid]: detail }));
    } catch (e: any) {
      toast.error(`Validation impossible : ${humanizeError(e)}`);
    } finally {
      setValidatingQid(null);
    }
  }, [annaleId, answers]);

  useEffect(() => {
    if (!annale || submitted) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (confirmingSubmit) setConfirmingSubmit(false);
        else setConfirmingSubmit(true);
        return;
      }

      if (shouldIgnoreShortcut(event.target) || confirmingSubmit || shortcutsOpen) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        toast.success('Brouillon local sauvegarde');
        return;
      }

      if (event.key === '?' || event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((idx) => Math.max(0, idx - 1));
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((idx) => Math.min(annale.questions.length - 1, idx + 1));
        return;
      }

      const question = annale.questions[currentIndex];
      if (!question) return;

      if ((event.key === 'Enter' || event.key === ' ') && examMode === 'libre') {
        if (!perQuestionDetails[question.id] && isAnswered(answers[question.id]) && validatingQid !== question.id) {
          event.preventDefault();
          validateOneQuestion(question.id);
        }
        return;
      }

      if (!/^[1-9]$/.test(event.key)) return;
      if (examMode === 'libre' && perQuestionDetails[question.id]) return;

      const option = question.options?.[Number(event.key) - 1];
      if (!option) return;

      event.preventDefault();
      setAnswers((prev) => {
        if (question.questionType === 'QRU') {
          return { ...prev, [question.id]: [option.id] };
        }

        if (question.questionType === 'QRM') {
          const selected = Array.isArray(prev[question.id]) ? (prev[question.id] as string[]) : [];
          const next = selected.includes(option.id)
            ? selected.filter((id) => id !== option.id)
            : [...selected, option.id];
          return { ...prev, [question.id]: next };
        }

        return prev;
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [annale, submitted, confirmingSubmit, shortcutsOpen, currentIndex, examMode, perQuestionDetails, answers, validatingQid, validateOneQuestion]);


  if (loadError) {
    return (
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-red-600 dark:text-red-400 mb-3">Erreur de chargement : {loadError}</p>
          <Link to="/entrainement" className="text-indigo-600 hover:underline">Retour à la liste des annales</Link>
        </div>
      </div>
    );
  }
  if (!annale) {
    return <ExamLoadingSkeleton />;
  }

  const currentQ = annale.questions[currentIndex];
  const total = annale.questions.length;
  const answeredCount = Object.keys(answers).filter((k) => isAnswered(answers[k])).length;
  const currentMarked = markedForReview.has(currentQ.id);
  const estimatedLimitSec = Math.max(30 * 60, total * 90);
  const estimatedRemainingSec = estimatedLimitSec - elapsedSec;
  const timerToneClass = estimatedRemainingSec <= 60
    ? 'bg-danger-100 text-danger-700 ring-1 ring-danger-500/30 dark:bg-danger-950/40 dark:text-danger-100 animate-pulse'
    : estimatedRemainingSec <= 5 * 60
    ? 'bg-warn-100 text-warn-700 ring-1 ring-warn-500/30 dark:bg-warn-950/40 dark:text-warn-100 animate-pulse'
    : 'text-neutral-700 dark:text-neutral-300';
  const timerTextClass = estimatedRemainingSec <= 60 ? 'text-2xl' : estimatedRemainingSec <= 5 * 60 ? 'text-lg' : 'text-sm';
  const liveDetails = Object.values(perQuestionDetails);
  const livePoints = liveDetails.reduce((sum, detail) => sum + (typeof detail.scoreValue === 'number' ? detail.scoreValue : 0), 0);
  const liveMaxPoints = liveDetails.reduce((sum, detail) => sum + (typeof detail.maxScore === 'number' ? detail.maxScore : 0), 0);

  const handleSubmit = async () => {
    if (!annaleId) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/annales/${encodeURIComponent(annaleId)}/grade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result: GradeResult = await r.json();
      await saveSession(result);
      if (storageKey) localStorage.removeItem(storageKey);
      if (marksStorageKey) localStorage.removeItem(marksStorageKey);
      setMarkedForReview(new Set());
      setHasRestoredDraft(false);
      setLastSavedAt(null);
      setSubmitted(result);
      setConfirmingSubmit(false);
    } catch (e: any) {
      toast.error(`Soumission impossible : ${humanizeError(e)}`);
    } finally { setSubmitting(false); }
  };

  // Validation d'UNE question en mode libre
  const handleValidateOne = async (qid: string) => {
    await validateOneQuestion(qid);
  };

  const handleRetry = () => {
    if (storageKey) localStorage.removeItem(storageKey);
    if (marksStorageKey) localStorage.removeItem(marksStorageKey);
    setAnswers({});
    setCurrentIndex(0);
    setStartedAt(Date.now());
    setElapsedSec(0);
    setSubmitted(null);
    setPerQuestionDetails({});
    setMarkedForReview(new Set());
    setHasRestoredDraft(false);
    setLastSavedAt(null);
    setDraftReady(true);
  };

  if (submitted) {
    return <ResultView annale={annale} result={submitted} seriesVignettes={seriesVignettes} onRetry={handleRetry} elapsedSec={elapsedSec} />;
  }

  // ── Layout 2 colonnes : sidebar navigation à gauche + contenu centré à droite ─────────
  return (
    <div className="h-full relative flex bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      {focusMode && (
        <button
          onClick={toggleFocusMode}
          className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
          title="Afficher la navigation"
        >
          <Minimize2 size={14} />
          Menu
        </button>
      )}
      {/* Sidebar navigation */}
      {!focusMode && (
      <aside className={`hidden shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 sm:flex flex-col overflow-hidden transition-[width] duration-200 ease-out ${examSidebarCompact ? 'w-20' : 'w-64'}`}>
        <div className={`${examSidebarCompact ? 'p-2' : 'p-4'} border-b border-neutral-200 dark:border-neutral-800`}>
          <div className={`mb-3 flex items-center gap-2 ${examSidebarCompact ? 'flex-col items-stretch' : 'justify-between'}`}>
            <button
              onClick={toggleExamSidebarCompact}
              className={`${examSidebarCompact ? 'mx-auto rounded-md p-2 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 hover:ring-indigo-400' : 'rounded-md p-1.5 text-neutral-400'} hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100`}
              title={examSidebarCompact ? 'Etendre la navigation' : 'Reduire la navigation'}
              aria-label={examSidebarCompact ? 'Etendre la navigation' : 'Reduire la navigation'}
            >
              {examSidebarCompact ? <ChevronRight size={18} /> : <ChevronLeft size={14} />}
            </button>
            <button
              onClick={() => navigate('/entrainement')}
              className={`${examSidebarCompact ? 'mx-auto rounded-md p-1.5' : 'flex items-center gap-1 text-xs'} text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100`}
              title="Quitter"
              aria-label="Quitter"
            >
              <ArrowLeft size={examSidebarCompact ? 16 : 13} /> {!examSidebarCompact && 'Quitter'}
            </button>
            <button
              onClick={toggleFocusMode}
              className={`${examSidebarCompact ? 'mx-auto' : ''} rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100`}
              title="Mode focus"
              aria-label="Mode focus"
            >
              <Maximize2 size={examSidebarCompact ? 16 : 14} />
            </button>
            {!examSidebarCompact && <button
              onClick={() => setShortcutsOpen(true)}
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              title="Raccourcis clavier"
            >
              <Keyboard size={14} />
            </button>}
          </div>
          <h1 className={`${examSidebarCompact ? 'sr-only' : ''} text-base font-bold text-neutral-900 dark:text-neutral-100 leading-snug line-clamp-2`}>
            {annale.title}
          </h1>
          <p className={`${examSidebarCompact ? 'hidden' : ''} text-xs text-neutral-500 mt-1`}>
            {annale.subject}{annale.year ? ` · ${annale.year}` : ''}
          </p>
          {/* Badge mode actif */}
          <span
            className={`${examSidebarCompact ? 'hidden' : 'inline-flex'} items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${
              examMode === 'exam'
                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
            }`}
            title={examMode === 'exam' ? 'Note à la fin' : 'Correction directe par question'}
          >
            {examMode === 'exam' ? '🎯 EXAMEN' : '📚 LIBRE'}
          </span>
          {!examSidebarCompact && (hasRestoredDraft || lastSavedAt) && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
              {hasRestoredDraft && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Reprise en cours" />
              )}
              {formatSavedAt(lastSavedAt) && (
                <span className="truncate">Sauvé · {formatSavedAt(lastSavedAt)}</span>
              )}
            </div>
          )}
        </div>

        {/* Chrono — compact */}
        <div className={`mx-3 mt-2 mb-1 rounded-md px-2.5 py-1 border border-neutral-200 dark:border-neutral-800 flex items-center ${examSidebarCompact ? 'justify-center' : 'justify-between'} font-mono transition-colors ${timerToneClass}`}>
          <span className={`${examSidebarCompact ? 'hidden' : 'flex'} items-center gap-1 text-[11px] text-neutral-500`}>
            <Clock size={12} />
            <span>Chrono</span>
          </span>
          <span className={`text-sm font-bold ${timerTextClass}`}>{formatElapsed(elapsedSec)}</span>
        </div>

        {/* Progression */}
        <div className={`${examSidebarCompact ? 'hidden' : ''} px-4 py-3 border-b border-neutral-200 dark:border-neutral-800`}>
          <div className="flex items-center justify-between text-xs text-neutral-500 mb-1.5">
            <span>Progression</span>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">{answeredCount} / {total}</span>
          </div>
          <div className="h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${total ? (answeredCount * 100) / total : 0}%` }}
            />
          </div>
          {markedForReview.size > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <Flag size={12} />
              {markedForReview.size} a revoir
            </div>
          )}
          {examMode === 'libre' && liveMaxPoints > 0 && (
            <div className="mt-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Score valide : {formatScoreNumber(livePoints)} / {formatScoreNumber(liveMaxPoints)}
            </div>
          )}
        </div>

        {/* Liste cliquable des questions */}
        <div className="flex-1 overflow-y-auto p-2">
          {annale.questions.map((q, i) => {
            const isCurrent = i === currentIndex;
            const hasAnswer = isAnswered(answers[q.id]);
            const isMarked = markedForReview.has(q.id);
            const isSeriesStart =
              q.seriesId && (i === 0 || annale.questions[i - 1]?.seriesId !== q.seriesId);

            return (
              <div key={q.id}>
                {isSeriesStart && (
                  <div className={`${examSidebarCompact ? 'hidden' : ''} mt-3 mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500`}>
                    {q.seriesFormat || 'DP'}
                    {q.customTitle ? ` — ${q.customTitle}` : ` — ${q.seriesId}`}
                  </div>
                )}
                <button
                  onClick={() => setCurrentIndex(i)}
                  className={`w-full flex items-center ${examSidebarCompact ? 'justify-center px-1.5 py-1.5' : 'gap-2.5 px-2.5 py-1.5'} rounded-md text-sm transition-colors ${
                    isCurrent
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 font-medium'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <span
                    className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : hasAnswer
                        ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                        : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500'
                    }`}
                  >
                    {hasAnswer && !isCurrent ? <Check size={12} /> : i + 1}
                  </span>
                  <span className={`${examSidebarCompact ? 'hidden' : 'flex-1'} text-left truncate text-xs`}>
                    {q.questionType}
                    {q.seriesId ? ` Q${q.seriesPosition}` : ''}
                  </span>
                  {isMarked && <Flag size={12} className="shrink-0 text-amber-500" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Soumettre */}
        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800">
          <button
            onClick={handleRetry}
            className="w-full mb-2 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            title="Recommencer"
          >
            <RotateCcw size={14} /> {!examSidebarCompact && 'Recommencer'}
          </button>
          <button
            onClick={() => setConfirmingSubmit(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 shadow-sm transition-colors"
            title="Soumettre l'annale"
          >
            <Send size={14} /> {!examSidebarCompact && "Soumettre l'annale"}
          </button>
        </div>
      </aside>
      )}

      {/* Zone centrale */}
      <main ref={mainScrollRef} className="flex-1 overflow-y-auto scroll-smooth">
        {!focusMode && (
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 sm:hidden">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm dark:border-neutral-800 dark:text-neutral-200"
            >
              <Menu size={16} />
              Questions
            </button>
            <div className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold ${timerToneClass}`}>
              {formatElapsed(elapsedSec)}
            </div>
          </div>
        )}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-[86vw] max-w-sm gap-0 p-0">
            <SheetHeader className="border-b border-neutral-200 dark:border-neutral-800">
              <SheetTitle className="pr-8 text-left text-base">{annale.title}</SheetTitle>
              <div className="text-left text-xs text-neutral-500">
                {answeredCount} / {total} repondues
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-5 gap-2">
                {annale.questions.map((q, i) => {
                  const isCurrent = i === currentIndex;
                  const hasAnswer = isAnswered(answers[q.id]);
                  const isMarked = markedForReview.has(q.id);
                  return (
                    <button
                      key={q.id}
                      onClick={() => {
                        setCurrentIndex(i);
                        setMobileNavOpen(false);
                      }}
                      className={`relative flex h-11 items-center justify-center rounded-lg border text-sm font-bold ${
                        isCurrent
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : hasAnswer
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'
                          : 'border-neutral-200 bg-white text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300'
                      }`}
                    >
                      {i + 1}
                      {isMarked && <Flag size={10} className="absolute right-1 top-1 text-amber-500" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <button
                  onClick={handleRetry}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-800 dark:text-neutral-200"
                >
                  <RotateCcw size={14} /> Recommencer
                </button>
                <button
                  onClick={() => {
                    setMobileNavOpen(false);
                    setConfirmingSubmit(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm"
                >
                  <Send size={14} /> Soumettre l'annale
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <div className="max-w-3xl mx-auto px-6 sm:px-10 py-8">
          {/* Vignette progressive */}
          {currentQ.seriesId && seriesVignettes.has(currentQ.seriesId) && (
            <ClinicalCase
              info={seriesVignettes.get(currentQ.seriesId)!}
              currentQid={currentQ.id}
              currentPosition={currentQ.seriesPosition || 0}
              isSubmitted={false}
              customTitle={currentQ.customTitle}
            />
          )}

          {/* Bandeau type + position */}
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <span className="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-medium uppercase tracking-wider">
              {currentQ.questionType}
            </span>
            {currentQ.seriesId && (
              <span className="px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium">
                {currentQ.seriesFormat || 'DP'} · Q{currentQ.seriesPosition}/{currentQ.seriesTotal}
              </span>
            )}
            <span className="text-neutral-400">Question {currentIndex + 1} / {total}</span>
            <button
              onClick={() => toggleMarkedForReview(currentQ.id)}
              className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium transition-colors ${
                currentMarked
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                  : 'border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
              title={currentMarked ? 'Retirer le marqueur' : 'Marquer pour y revenir'}
            >
              <Flag size={13} />
              {currentMarked ? 'A revoir' : 'Marquer'}
            </button>
            <button
              onClick={() => handleCopyQuestion(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40 transition-colors"
              title={currentQ.seriesId ? 'Copier (cas clinique + énoncé + propositions)' : 'Copier (énoncé + propositions)'}
              aria-label="Copier la question complète"
            >
              <Clipboard size={13} />
              Copier
            </button>
            <button
              onClick={() => setReportOpen(true)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-[11px] font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-900/40 transition-colors"
              title="Signaler une coquille (vignette manquante, énoncé tronqué, etc)"
              aria-label="Signaler une coquille sur cette question"
            >
              !
            </button>
            <button
              onClick={handleEditCurrentQuestion}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40 transition-colors"
              title="Corriger directement cette question (admin)"
              aria-label="Corriger cette question"
            >
              ✎
            </button>
          </div>

          {/* Énoncé */}
          <h2 className="text-lg leading-relaxed font-medium text-neutral-900 dark:text-neutral-100 mb-6 whitespace-pre-wrap">
            {currentQ.text}
          </h2>

          {/* Image */}
          {currentQ.image && (
            <div className="mb-6 flex justify-center">
              <img
                src={`/api/annales/${annale.id}/img/${currentQ.image}`}
                alt=""
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 max-w-full max-h-[600px] object-contain"
              />
            </div>
          )}

          {/* Réponses */}
          {(() => {
            const isValidated = examMode === 'libre' && perQuestionDetails[currentQ.id];
            const validateDisabled = validatingQid === currentQ.id || !isAnswered(answers[currentQ.id]);
            return (
              <>
                <AnswerInput
                  question={currentQ}
                  value={
                    answers[currentQ.id] ??
                    (currentQ.questionType === 'QRM' ? [] : currentQ.questionType === 'QROC' || currentQ.questionType === 'ZONE' ? '' : '')
                  }
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [currentQ.id]: v }))}
                  disabled={!!isValidated}
                />

                {/* Petit bouton "copier sans vignette" - uniquement si la question est dans un DP avec vignette,
                    sinon le grand bouton "Copier" en haut suffit (pas de vignette à exclure). */}
                {currentQ.seriesId && seriesVignettes.get(currentQ.seriesId) && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleCopyQuestion(false)}
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 transition-colors"
                      title="Copier juste l'énoncé + propositions (sans le cas clinique)"
                      aria-label="Copier sans la vignette"
                    >
                      <Clipboard size={11} />
                      Copier sans vignette
                    </button>
                  </div>
                )}

                {/* Mode libre : bouton Valider OU correction inline si déjà validé */}
                {examMode === 'libre' && !isValidated && (
                  <div className="mt-4 flex justify-end">
                    <DisabledHint
                      active={validateDisabled}
                      message={validatingQid === currentQ.id ? 'Validation en cours' : 'Reponds d abord a la question'}
                    >
                      <button
                        onClick={() => handleValidateOne(currentQ.id)}
                        disabled={validateDisabled}
                        className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed text-white text-sm font-medium shadow-sm transition-all duration-150 hover:shadow-lg active:scale-95"
                      >
                        <Sparkles size={14} />
                        {validatingQid === currentQ.id ? 'Validation…' : 'Valider la réponse'}
                      </button>
                    </DisabledHint>
                  </div>
                )}

                {examMode === 'libre' && isValidated && (
                  <InlineCorrection detail={perQuestionDetails[currentQ.id]} annaleId={annale.id} />
                )}
              </>
            );
          })()}

          {/* Navigation prev/next */}
          <div className="mt-10 flex items-center justify-between pt-6 border-t border-neutral-200 dark:border-neutral-800">
            <button
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} /> Précédente
            </button>
            <button
              onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
              disabled={currentIndex === total - 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Suivante <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </main>

      {confirmingSubmit && (
        <ConfirmSubmitModal
          answeredCount={answeredCount} total={total}
          submitting={submitting} onConfirm={handleSubmit}
          onCancel={() => setConfirmingSubmit(false)}
        />
      )}

      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}

      {currentQ && (
        <ReportIssueModal
          open={reportOpen}
          onOpenChange={setReportOpen}
          annaleId={annale.id}
          questionId={currentQ.id}
          questionLabel={
            currentQ.seriesId
              ? `${currentQ.seriesFormat || 'DP'} Q${currentQ.seriesPosition}/${currentQ.seriesTotal} · ${currentQ.questionType}`
              : `Question ${currentIndex + 1} · ${currentQ.questionType}`
          }
        />
      )}

      {/* Loader pendant chargement du raw admin */}
      {editorOpen && editorLoading && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="rounded-lg bg-neutral-900/90 px-4 py-3 text-sm text-white">
            <Loader2 size={16} className="mr-2 inline-block animate-spin" /> Chargement…
          </div>
        </div>
      )}
      {editorQuestion && annale && (
        <QuestionEditorModal
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) setEditorQuestion(null);
          }}
          annaleId={annale.id}
          question={editorQuestion}
          onSaved={handleAfterEdit}
        />
      )}
    </div>
  );
}

function ExamLoadingSkeleton() {
  return (
    <div className="h-full flex bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-5">
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 sm:px-10 py-8 space-y-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-5/6" />
          <div className="space-y-3 pt-2">
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AnswerInput — options en grandes cards façon Hypocampus
// ─────────────────────────────────────────────────────────────────────

function AnswerInput({
  question, value, onChange, disabled,
}: { question: PlayQuestion; value: AnswerValue; onChange: (v: AnswerValue) => void; disabled?: boolean; }) {
  const t = question.questionType;
  const compactOptions = (question.options || []).length > 6;

  if (t === 'QRU') {
    const selected = Array.isArray(value) ? value[0] : (value as string);
    return (
      <div className={compactOptions ? 'space-y-1.5' : 'space-y-2'}>
        {(question.options || []).map((o) => (
          <OptionCard
            key={o.id}
            id={o.id}
            text={o.text}
            selected={selected === o.id}
            onClick={() => !disabled && onChange([o.id])}
            type="radio"
            disabled={disabled}
            compact={compactOptions}
          />
        ))}
      </div>
    );
  }

  if (t === 'QRM') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (id: string) => {
      if (disabled) return;
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    };
    return (
      <div className={compactOptions ? 'space-y-1.5' : 'space-y-2'}>
        {(question.options || []).map((o) => (
          <OptionCard
            key={o.id}
            id={o.id}
            text={o.text}
            selected={selected.includes(o.id)}
            onClick={() => toggle(o.id)}
            type="checkbox"
            disabled={disabled}
            compact={compactOptions}
          />
        ))}
      </div>
    );
  }

  if (t === 'QROC' || t === 'ZONE') {
    const text = typeof value === 'string' ? value : '';
    return (
      <div>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          readOnly={disabled}
          aria-readonly={disabled || undefined}
          placeholder={
            t === 'QROC'
              ? 'Réponse libre…'
              : 'Décris ce que tu observes sur l\'image (zones, repères, diagnostic)…'
          }
          className="w-full min-h-[140px] p-4 border border-neutral-300 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 text-[15px] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent leading-relaxed resize-y read-only:opacity-90"
        />
        <p className="mt-1.5 text-xs text-neutral-400">
          Ta réponse ne sera pas notée automatiquement. La correction officielle s'affichera après soumission.
        </p>
      </div>
    );
  }

  return <div className="text-neutral-500 italic">Type de question inconnu</div>;
}

function OptionCard({
  id, text, selected, onClick, type, disabled, compact,
}: { id: string; text: string; selected: boolean; onClick: () => void; type: 'radio' | 'checkbox'; disabled?: boolean; compact?: boolean; }) {
  const handleClick = () => {
    if (disabled) return;
    if (window.getSelection()?.toString()) return;
    onClick();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };

  return (
    <div
      role={type}
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`w-full text-left flex items-start ${compact ? 'gap-3 p-3 rounded-lg' : 'gap-4 p-4 rounded-xl'} border-2 transition-all select-text ${
        disabled ? 'cursor-text' : 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-950'
      } ${
        selected
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
          : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700'
      }`}
    >
      <span
        className={`shrink-0 ${compact ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm'} ${type === 'radio' ? 'rounded-full' : 'rounded-lg'} flex items-center justify-center font-bold transition-colors ${
          selected
            ? 'bg-indigo-600 text-white'
            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
        }`}
      >
        {selected ? <Check size={compact ? 14 : 16} /> : id}
      </span>
      <span className={`flex-1 ${compact ? 'pt-0.5 text-sm leading-snug' : 'pt-1 text-[15px] leading-relaxed'} text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words`}>
        {text}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// InlineCorrection : affichée sous la question en mode libre après validation
// ─────────────────────────────────────────────────────────────────────

function InlineCorrection({ detail: d, annaleId }: { detail: GradeDetail; annaleId: string }) {
  const cfg = scoreVisual(d);
  const Icon = cfg.icon;
  const mistakeLabel = scoreMistakeLabel(d);

  return (
    <div className={`mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 ring-2 ${cfg.ring} p-5 shadow-sm`}>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <Icon size={16} className={cfg.accent} />
        <span className={`font-bold uppercase tracking-wider ${cfg.accent}`}>{cfg.label}</span>
        <span className={`rounded-md px-2 py-1 font-mono text-xs font-bold ${cfg.badgeClass}`}>
          {cfg.badge}
        </span>
        {mistakeLabel && <span className="text-neutral-500 dark:text-neutral-400">{mistakeLabel}</span>}
      </div>

      {/* Options corrigées */}
      {d.options && (
        <div className="space-y-1.5 mb-3">
          {d.options.map((o) => {
            const userPicked = Array.isArray(d.userAnswer) && d.userAnswer.includes(o.id);
            return (
              <div
                key={o.id}
                className={`flex items-start gap-3 p-2.5 rounded-lg text-sm border ${
                  o.correct
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-900 dark:text-green-200'
                    : userPicked
                    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-900 dark:text-red-200'
                    : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-400'
                }`}
              >
                <span className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                  o.correct ? 'bg-green-600 text-white' : userPicked ? 'bg-red-600 text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                }`}>
                  {o.id}
                </span>
                <span className="flex-1 leading-relaxed">{o.text}</span>
                {o.correct && <CheckCircle2 size={16} className="text-green-700 dark:text-green-400 shrink-0 mt-0.5" />}
                {userPicked && !o.correct && <XCircle size={16} className="text-red-700 dark:text-red-400 shrink-0 mt-0.5" />}
              </div>
            );
          })}
        </div>
      )}

      {d.answerSource === 'ai' && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <span>Corrigé <strong>généré par IA</strong> (absent du PDF source) — à vérifier avec un référentiel/cours avant de le mémoriser.</span>
        </div>
      )}

      {/* QROC/Zone */}
      {(d.questionType === 'QROC' || d.questionType === 'ZONE') && d.expectedAnswer && (
        <div className="mb-3">
          <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${d.answerSource === 'ai' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
            {d.answerSource === 'ai' ? 'Réponse générée par IA — à vérifier' : 'Réponse officielle'}
          </div>
          <div className={`text-sm p-3 rounded-lg border whitespace-pre-wrap leading-relaxed ${d.answerSource === 'ai' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200' : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-900 dark:text-green-200'}`}>
            {d.expectedAnswer}
          </div>
        </div>
      )}

      {d.correctedImage && (
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
            Correction visuelle
          </div>
          <img
            src={`/api/annales/${annaleId}/img/${d.correctedImage}`}
            alt=""
            className="rounded-lg border border-neutral-200 dark:border-neutral-700 max-w-full max-h-[400px] object-contain"
          />
        </div>
      )}

      {/* Correction détaillée OU message d'absence */}
      {d.correctionText ? (
        <details className="text-sm group" open>
          <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300 select-none flex items-center gap-1.5">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Correction détaillée
          </summary>
          <div className="mt-2 ml-5 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 leading-relaxed">
            {d.correctionText}
          </div>
        </details>
      ) : (
        <div className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 border border-dashed border-neutral-300 dark:border-neutral-700">
          Pas de commentaire de correction écrit dans le PDF source. Réfère-toi aux bonnes réponses cochées + un manuel/livre de cours.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal de confirmation
// ─────────────────────────────────────────────────────────────────────

function ConfirmSubmitModal({
  answeredCount, total, submitting, onConfirm, onCancel,
}: {
  answeredCount: number; total: number; submitting: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const unanswered = total - answeredCount;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold">Soumettre l'annale ?</h3>
            <p className="text-sm text-neutral-500 mt-1">
              {unanswered > 0
                ? `Il te reste ${unanswered} question(s) sans réponse. Elles seront comptées comme fausses (QRU/QRM) ou non comptées (QROC/Zone).`
                : 'Toutes les questions sont répondues. Bonne chance !'}
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onCancel} disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Continuer
          </button>
          <button
            onClick={onConfirm} disabled={submitting}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 shadow-sm"
          >
            {submitting ? 'Soumission…' : 'Soumettre'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ['← / →', 'Question precedente / suivante'],
    ['1-9', 'Cocher ou decocher les propositions'],
    ['Entree / Espace', 'Valider en mode libre'],
    ['Ctrl+S', 'Confirmer la sauvegarde locale'],
    ['Esc', 'Ouvrir ou fermer la confirmation'],
    ['? ou H', 'Afficher cette aide'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Raccourcis clavier</h3>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Disponibles hors champs texte.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            Fermer
          </button>
        </div>
        <div className="space-y-2">
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
              <kbd className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs font-bold text-neutral-700 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                {keys}
              </kbd>
              <span className="text-right text-sm text-neutral-600 dark:text-neutral-300">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Vue résultats
// ─────────────────────────────────────────────────────────────────────

function ResultView({
  annale, result, seriesVignettes, onRetry, elapsedSec,
}: {
  annale: PlayAnnale; result: GradeResult;
  seriesVignettes: Map<string, SeriesVignetteInfo>;
  onRetry: () => void; elapsedSec: number;
}) {
  const navigate = useNavigate();
  const { finalScore, details } = result;
  const scoreGradient = scoreGradientClass(finalScore.percentage);
  const points = finalPoints(finalScore);
  const maxPoints = finalMaxPoints(finalScore);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => navigate('/entrainement')}
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 flex items-center gap-1"
          >
            <ArrowLeft size={16} /> Annales
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold truncate">Résultats — {annale.title}</h1>
            <p className="text-xs text-neutral-500 font-mono">Durée : {formatElapsed(elapsedSec)}</p>
          </div>
          <button
            onClick={onRetry}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-sm"
          >
            <RotateCcw size={14} /> Refaire l'annale
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 pb-24">
        {/* Note finale */}
        <div className={`bg-gradient-to-br ${scoreGradient} text-white rounded-3xl p-10 mb-8 text-center shadow-lg`}>
          <div className="text-xs font-bold uppercase tracking-wider opacity-80 mb-2">Note finale</div>
          <div className="text-7xl font-bold mb-2">
            {formatScoreNumber(points)} / {formatScoreNumber(maxPoints)}
          </div>
          {finalScore.percentage !== null && (
            <div className="text-2xl opacity-90">{finalScore.percentage}%</div>
          )}
          <div className="mt-6 flex justify-center gap-4 text-sm flex-wrap">
            <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg">
              <CheckCircle2 size={15} /> {finalScore.juste} a 1 pt
            </span>
            {(finalScore.partiel || 0) > 0 && (
              <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg">
                <HelpCircle size={15} /> {finalScore.partiel} partielle{finalScore.partiel && finalScore.partiel > 1 ? 's' : ''}
              </span>
            )}
            <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg">
              <XCircle size={15} /> {finalScore.faux} a 0
            </span>
            {finalScore.nonComptees > 0 && (
              <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg">
                <HelpCircle size={15} /> {finalScore.nonComptees} à revoir
              </span>
            )}
          </div>
        </div>

        {/* Détail */}
        <h2 className="text-lg font-bold mb-4 text-neutral-900 dark:text-neutral-100">
          Détail des questions
        </h2>
        <div className="space-y-5">
          {details.map((d, i) => {
            const showVignette =
              d.seriesId &&
              seriesVignettes.has(d.seriesId) &&
              (i === 0 || details[i - 1]?.seriesId !== d.seriesId);
            return (
              <div key={d.qid}>
                {showVignette && (
                  <ClinicalCase
                    info={seriesVignettes.get(d.seriesId!)!}
                    currentQid="-"
                    currentPosition={0}
                    isSubmitted={true}
                  />
                )}
                <ResultCard detail={d} index={i} annaleId={annale.id} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function ResultCard({
  detail: d, index, annaleId,
}: { detail: GradeResult['details'][number]; index: number; annaleId: string; }) {
  const cfg = {
    juste: { label: 'Juste', icon: CheckCircle2, ring: 'ring-green-500/30', accent: 'text-green-700 dark:text-green-400', bg: 'bg-white dark:bg-neutral-900' },
    faux: { label: 'Faux', icon: XCircle, ring: 'ring-red-500/30', accent: 'text-red-700 dark:text-red-400', bg: 'bg-white dark:bg-neutral-900' },
    partiel: { label: 'Partiel', icon: HelpCircle, ring: 'ring-amber-500/30', accent: 'text-amber-700 dark:text-amber-400', bg: 'bg-white dark:bg-neutral-900' },
    'non-comptee': { label: 'À revoir', icon: HelpCircle, ring: 'ring-amber-500/30', accent: 'text-amber-700 dark:text-amber-400', bg: 'bg-white dark:bg-neutral-900' },
  }[d.result] || scoreVisual(d);
  const Icon = cfg.icon;
  const mistakeLabel = scoreMistakeLabel(d);

  return (
    <div className={`rounded-2xl border border-neutral-200 dark:border-neutral-800 ${cfg.bg} ring-2 ${cfg.ring} p-6 shadow-sm`}>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <Icon size={16} className={cfg.accent} />
        <span className={`font-bold uppercase tracking-wider ${cfg.accent}`}>{cfg.label}</span>
        <span className="rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs font-bold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
          {formatScoreNumber(d.scoreValue)} / {formatScoreNumber(d.maxScore)}
        </span>
        {mistakeLabel && <span className="text-neutral-500 dark:text-neutral-400">{mistakeLabel}</span>}
        <span className="text-neutral-400">·</span>
        <span className="font-mono text-neutral-500">Q{index + 1}</span>
        <span className="text-neutral-400">·</span>
        <span className="text-neutral-500 uppercase">{d.questionType}</span>
        {d.seriesId && (
          <>
            <span className="text-neutral-400">·</span>
            <span className="text-neutral-500">{d.seriesFormat || 'DP'} Q{d.seriesPosition}</span>
          </>
        )}
      </div>

      <p className="text-base font-medium mb-4 whitespace-pre-wrap text-neutral-900 dark:text-neutral-100 leading-relaxed">
        {d.text}
      </p>

      {d.image && (
        <img
          src={`/api/annales/${annaleId}/img/${d.image}`} alt=""
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 mb-4 max-w-full max-h-[400px] object-contain"
        />
      )}

      {/* QCM corrigé */}
      {d.options && (
        <div className="space-y-1.5 mb-4">
          {d.options.map((o) => {
            const userPicked = Array.isArray(d.userAnswer) && d.userAnswer.includes(o.id);
            return (
              <div
                key={o.id}
                className={`flex items-start gap-3 p-3 rounded-lg text-sm border ${
                  o.correct
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-900 dark:text-green-200'
                    : userPicked
                    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-900 dark:text-red-200'
                    : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-400'
                }`}
              >
                <span className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                  o.correct ? 'bg-green-600 text-white' : userPicked ? 'bg-red-600 text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                }`}>
                  {o.id}
                </span>
                <span className="flex-1 leading-relaxed">{o.text}</span>
                {o.correct && <CheckCircle2 size={16} className="text-green-700 dark:text-green-400 shrink-0 mt-0.5" />}
                {userPicked && !o.correct && <XCircle size={16} className="text-red-700 dark:text-red-400 shrink-0 mt-0.5" />}
              </div>
            );
          })}
        </div>
      )}

      {/* QROC/Zone : saisie + officielle */}
      {(d.questionType === 'QROC' || d.questionType === 'ZONE') && (
        <div className="space-y-3 mb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
              Ta réponse
            </div>
            <div className="text-sm bg-neutral-50 dark:bg-neutral-800/60 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">
              {typeof d.userAnswer === 'string' && d.userAnswer
                ? d.userAnswer
                : <span className="italic text-neutral-400">Pas de réponse</span>}
            </div>
          </div>
          {d.expectedAnswer && (
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${d.answerSource === 'ai' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                {d.answerSource === 'ai' ? 'Réponse générée par IA — à vérifier' : 'Réponse officielle'}
              </div>
              <div className={`text-sm p-3 rounded-lg border whitespace-pre-wrap leading-relaxed ${d.answerSource === 'ai' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200' : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50 text-green-900 dark:text-green-200'}`}>
                {d.expectedAnswer}
              </div>
            </div>
          )}
          {d.correctedImage && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                Correction visuelle
              </div>
              <img
                src={`/api/annales/${annaleId}/img/${d.correctedImage}`} alt=""
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 max-w-full max-h-[400px] object-contain"
              />
            </div>
          )}
        </div>
      )}

      {d.answerSource === 'ai' && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <span>Corrigé <strong>généré par IA</strong> (absent du PDF source) — à vérifier avec un référentiel/cours avant de le mémoriser.</span>
        </div>
      )}

      {/* Correction détaillée OU message d'absence */}
      {d.correctionText ? (
        <details className="text-sm group">
          <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 select-none flex items-center gap-1.5">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Correction détaillée
          </summary>
          <div className="mt-3 ml-5 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 leading-relaxed">
            {d.correctionText}
          </div>
        </details>
      ) : (
        <div className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 border border-dashed border-neutral-300 dark:border-neutral-700">
          Pas de commentaire de correction écrit dans le PDF source. Réfère-toi aux bonnes réponses cochées + un manuel/livre de cours.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function isAnswered(v: AnswerValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}
