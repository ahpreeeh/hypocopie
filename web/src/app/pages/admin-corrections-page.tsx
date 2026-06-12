import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { REPORT_CATEGORIES } from '../components/report-issue-modal';
import { humanizeError } from '../ui-feedback';

type Source = 'auto' | 'reported';
type StatusFilter = 'open' | 'resolved' | 'all';
type SourceFilter = 'all' | Source;
type QuestionType = 'QRU' | 'QRM' | 'QROC' | 'ZONE';
type TabKey = 'content' | 'options' | 'series' | 'images' | 'source' | 'validation';

interface AnnaleSummary {
  id: string;
  title?: string;
  subject?: string;
  year?: number;
  session?: string;
}

interface OptionItem {
  id: string;
  text: string;
  correct?: boolean;
}

interface QuestionImage {
  id?: string;
  filename?: string;
  label?: string;
}

interface AdminQuestion {
  id: string;
  questionType: QuestionType;
  text: string;
  image?: string | null;
  images?: QuestionImage[];
  options?: OptionItem[];
  expectedAnswer?: string | null;
  correctionText?: string | null;
  seriesId?: string | null;
  seriesFormat?: 'DP' | 'KFP' | null;
  seriesPosition?: number | null;
  seriesTotal?: number | null;
  vignette?: string | null;
  customTitle?: string | null;
}

interface AdminAnnale {
  id: string;
  title?: string;
  subject?: string;
  year?: number;
  session?: string;
  revision?: number;
  updatedAt?: string;
  questions: AdminQuestion[];
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  questionId: string | null;
  code: string;
  message: string;
}

interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  counts: { error: number; warning: number; info: number };
}

interface SourceInfo {
  files: { name: string; text: string }[];
  excerpt?: { file: string; text: string } | null;
  sourceBlocks: { draftId: string; id?: string; title?: string; cleanText: string; images?: unknown[] }[];
}

interface WorkRow {
  source: Source;
  annaleId: string;
  annaleTitle: string | null;
  questionId: string;
  category: string;
  categoryLabel: string;
  note: string | null;
  reportId: string | null;
  excerpt?: string | null;
  annaleOrphan: boolean;
}

interface ReportEntry {
  id: string;
  annaleId: string;
  questionId: string;
  category: string;
  note: string | null;
  status: string;
  createdAt: string;
}

const CATEGORY_LABEL_MAP = new Map(REPORT_CATEGORIES.map((c) => [c.value, c.label]));
const OPTION_LIMIT = 15;
const OPTION_IDS = 'ABCDEFGHIJKLMNO'.split('');

export function AdminCorrectionsPage() {
  const [rows, setRows] = useState<WorkRow[] | null>(null);
  const [annales, setAnnales] = useState<AnnaleSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [queueSearch, setQueueSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedRow, setSelectedRow] = useState<WorkRow | null>(null);
  const [selectedAnnaleId, setSelectedAnnaleId] = useState<string | null>(null);
  const [annale, setAnnale] = useState<AdminAnnale | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<AdminQuestion | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('content');
  const [loadingAnnale, setLoadingAnnale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const loadQueue = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const fetchAuto = statusFilter !== 'resolved' && sourceFilter !== 'reported';
      const [orphanRes, reportsRes, annalesRes] = await Promise.all([
        fetchAuto ? fetch('/api/admin/orphan-vignettes') : Promise.resolve(null),
        fetch(`/api/reports?status=${statusFilter}`),
        fetch('/api/annales'),
      ]);
      if (orphanRes && !orphanRes.ok) throw new Error(`orphan-vignettes HTTP ${orphanRes.status}`);
      if (!reportsRes.ok) throw new Error(`reports HTTP ${reportsRes.status}`);
      if (!annalesRes.ok) throw new Error(`annales HTTP ${annalesRes.status}`);

      const annalesList: AnnaleSummary[] = await annalesRes.json();
      setAnnales(Array.isArray(annalesList) ? annalesList : []);
      const existingIds = new Set((Array.isArray(annalesList) ? annalesList : []).map((a) => a.id));
      const orphanData = orphanRes ? await orphanRes.json() : { annales: [] };
      const reportsData = await reportsRes.json();
      const unified: WorkRow[] = [];

      for (const a of orphanData.annales || []) {
        for (const q of a.questions || []) {
          unified.push({
            source: 'auto',
            annaleId: a.id,
            annaleTitle: a.title || a.id,
            questionId: q.id,
            category: 'vignette-missing',
            categoryLabel: 'Vignette absente',
            note: q.pattern ? `Pattern: ${q.pattern}` : null,
            reportId: null,
            excerpt: q.textExcerpt || null,
            annaleOrphan: existingIds.size > 0 && !existingIds.has(a.id),
          });
        }
      }

      for (const r of reportsData.reports || []) {
        unified.push({
          source: 'reported',
          annaleId: r.annaleId,
          annaleTitle: annalesList.find((a) => a.id === r.annaleId)?.title || r.annaleId,
          questionId: r.questionId,
          category: r.category,
          categoryLabel: CATEGORY_LABEL_MAP.get(r.category) || r.category,
          note: r.note,
          reportId: r.id,
          annaleOrphan: existingIds.size > 0 && !existingIds.has(r.annaleId),
        });
      }

      unified.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'reported' ? -1 : 1;
        return a.annaleId.localeCompare(b.annaleId) || a.questionId.localeCompare(b.questionId);
      });
      setRows(unified);
    } catch (e: any) {
      setError(humanizeError(e?.message || String(e)));
    } finally {
      setRefreshing(false);
    }
  }, [sourceFilter, statusFilter]);

  const loadAnnale = useCallback(async (annaleId: string, questionId?: string | null) => {
    setLoadingAnnale(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/annales/${encodeURIComponent(annaleId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      const raw = data.annale as AdminAnnale;
      setAnnale(raw);
      setValidation(data.validation as ValidationReport);
      setSelectedAnnaleId(annaleId);
      const firstQid = questionId && raw.questions.some((q) => q.id === questionId)
        ? questionId
        : raw.questions[0]?.id || null;
      setSelectedQuestionId(firstQid);
      setDraftQuestion(cloneQuestion(raw.questions.find((q) => q.id === firstQid) || null));
      setActiveTab('content');
    } catch (e: any) {
      toast.error(`Chargement impossible : ${e?.message || e}`);
      setAnnale(null);
      setValidation(null);
      setDraftQuestion(null);
    } finally {
      setLoadingAnnale(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const selectedQuestion = useMemo(
    () => annale?.questions.find((q) => q.id === selectedQuestionId) || null,
    [annale, selectedQuestionId],
  );
  const selectedIndex = useMemo(
    () => annale?.questions.findIndex((q) => q.id === selectedQuestionId) ?? -1,
    [annale, selectedQuestionId],
  );

  const questionIssues = useMemo(() => {
    if (!validation || !selectedQuestionId) return [];
    return validation.issues.filter((issue) => issue.questionId === selectedQuestionId || issue.questionId === null);
  }, [selectedQuestionId, validation]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows || []) seen.set(row.category, row.categoryLabel);
    return Array.from(seen.entries());
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    return (rows || []).filter((row) => {
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (!query) return true;
      return [row.annaleId, row.annaleTitle, row.questionId, row.categoryLabel, row.note, row.excerpt]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [categoryFilter, queueSearch, rows, sourceFilter]);

  const selectQuestion = useCallback((qid: string) => {
    const question = annale?.questions.find((q) => q.id === qid) || null;
    setSelectedQuestionId(qid);
    setDraftQuestion(cloneQuestion(question));
    setSourceInfo(null);
  }, [annale]);

  const updateDraft = useCallback((patch: Partial<AdminQuestion>) => {
    setDraftQuestion((current) => current ? { ...current, ...patch } : current);
  }, []);

  const updateOption = useCallback((index: number, patch: Partial<OptionItem>) => {
    setDraftQuestion((current) => {
      if (!current) return current;
      const options = [...(current.options || [])];
      options[index] = { ...options[index], ...patch };
      return { ...current, options };
    });
  }, []);

  const saveQuestion = useCallback(async (resolveAfter = false) => {
    if (!selectedAnnaleId || !draftQuestion) return;
    setSaving(true);
    try {
      const question = normalizeBeforeSave(draftQuestion);
      const res = await fetch(
        `/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions/${encodeURIComponent(question.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.validation) setValidation(data.validation);
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      toast.success(data.sessionsImpacted ? `Sauvegardé. ${data.sessionsImpacted} session(s) impactée(s).` : 'Question sauvegardée');
      if (resolveAfter && selectedRow?.reportId) await resolveReport(selectedRow.reportId);
      await loadAnnale(selectedAnnaleId, question.id);
      await loadQueue();
    } catch (e: any) {
      toast.error(`Sauvegarde refusée : ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [draftQuestion, loadAnnale, loadQueue, selectedAnnaleId, selectedRow]);

  const addQuestion = useCallback(async () => {
    if (!selectedAnnaleId || !selectedQuestionId) return;
    try {
      const res = await fetch(`/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afterQuestionId: selectedQuestionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      toast.success('Question ajoutée');
      await loadAnnale(selectedAnnaleId, data.question?.id);
    } catch (e: any) {
      toast.error(`Ajout impossible : ${e?.message || e}`);
    }
  }, [loadAnnale, selectedAnnaleId, selectedQuestionId]);

  const deleteQuestion = useCallback(async () => {
    if (!selectedAnnaleId || !selectedQuestionId) return;
    if (!window.confirm(`Supprimer ${selectedQuestionId} ?`)) return;
    try {
      const res = await fetch(
        `/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions/${encodeURIComponent(selectedQuestionId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      toast.success(data.sessionsImpacted ? `Question supprimée. ${data.sessionsImpacted} session(s) impactée(s).` : 'Question supprimée');
      const next = annale?.questions[Math.max(0, selectedIndex - 1)]?.id;
      await loadAnnale(selectedAnnaleId, next);
      await loadQueue();
    } catch (e: any) {
      toast.error(`Suppression impossible : ${e?.message || e}`);
    }
  }, [annale, loadAnnale, loadQueue, selectedAnnaleId, selectedIndex, selectedQuestionId]);

  const moveQuestion = useCallback(async (direction: -1 | 1) => {
    if (!annale || !selectedAnnaleId || selectedIndex < 0) return;
    const targetIndex = selectedIndex + direction;
    if (targetIndex < 0 || targetIndex >= annale.questions.length) return;
    const ids = annale.questions.map((q) => q.id);
    [ids[selectedIndex], ids[targetIndex]] = [ids[targetIndex], ids[selectedIndex]];
    try {
      const res = await fetch(`/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: ids }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      await loadAnnale(selectedAnnaleId, selectedQuestionId);
    } catch (e: any) {
      toast.error(`Réordonnancement impossible : ${e?.message || e}`);
    }
  }, [annale, loadAnnale, selectedAnnaleId, selectedIndex, selectedQuestionId]);

  const uploadImage = useCallback(async (file: File) => {
    if (!selectedAnnaleId || !selectedQuestionId) return;
    setUploadingImage(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(
        `/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions/${encodeURIComponent(selectedQuestionId)}/images`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, label: file.name }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      toast.success('Image attachée');
      await loadAnnale(selectedAnnaleId, selectedQuestionId);
    } catch (e: any) {
      toast.error(`Upload image impossible : ${e?.message || e}`);
    } finally {
      setUploadingImage(false);
    }
  }, [loadAnnale, selectedAnnaleId, selectedQuestionId]);

  const deleteImage = useCallback(async (filename: string) => {
    if (!selectedAnnaleId || !selectedQuestionId) return;
    const res = await fetch(
      `/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/questions/${encodeURIComponent(selectedQuestionId)}/images/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(`Suppression image impossible : ${(data && data.error) || `HTTP ${res.status}`}`);
      return;
    }
    toast.success('Image supprimée');
    await loadAnnale(selectedAnnaleId, selectedQuestionId);
  }, [loadAnnale, selectedAnnaleId, selectedQuestionId]);

  const validateAnnale = useCallback(async () => {
    if (!selectedAnnaleId) return;
    const res = await fetch(`/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/validate`, { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(`Validation impossible : ${(data && data.error) || `HTTP ${res.status}`}`);
      return;
    }
    setValidation(data);
    toast.success(data.ok ? 'Annale valide' : `${data.counts.error} erreur(s), ${data.counts.warning} warning(s)`);
  }, [selectedAnnaleId]);

  const loadSourceInfo = useCallback(async () => {
    if (!selectedAnnaleId || !selectedQuestionId) return;
    setSourceLoading(true);
    try {
      const res = await fetch(
        `/api/admin/annales/${encodeURIComponent(selectedAnnaleId)}/source?questionId=${encodeURIComponent(selectedQuestionId)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      setSourceInfo(data as SourceInfo);
    } catch (e: any) {
      toast.error(`Source indisponible : ${e?.message || e}`);
      setSourceInfo(null);
    } finally {
      setSourceLoading(false);
    }
  }, [selectedAnnaleId, selectedQuestionId]);

  const suggestLocalPatch = useCallback(() => {
    if (!draftQuestion) return;
    const corrected = { ...draftQuestion, options: [...(draftQuestion.options || [])] };
    const source = `${corrected.correctionText || ''}\n${corrected.expectedAnswer || ''}`;
    const letters = new Set((source.match(/\b[A-O]\b/g) || []).filter((x) => OPTION_IDS.includes(x)));
    if (corrected.options?.length && letters.size > 0) {
      corrected.options = corrected.options.map((opt) => ({ ...opt, correct: letters.has(opt.id) }));
    }
    if (!corrected.seriesId && /Madame|Mme|Monsieur|Mr\.|cette patiente|ce patient/i.test(corrected.text)) {
      corrected.seriesFormat = 'DP';
      corrected.seriesId = `dp-${selectedAnnaleId || 'annale'}-${corrected.id}`;
      corrected.customTitle = corrected.customTitle || `DP ${corrected.id}`;
      corrected.vignette = corrected.vignette || corrected.text;
    }
    setDraftQuestion(normalizeBeforeSave(corrected));
    toast.info('Suggestion locale appliquée au brouillon. Vérifie avant sauvegarde.');
  }, [draftQuestion, selectedAnnaleId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      const isEditingText = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveQuestion(false);
      }
      if (!isEditingText && event.altKey && event.key === 'ArrowRight' && annale && selectedIndex < annale.questions.length - 1) {
        selectQuestion(annale.questions[selectedIndex + 1].id);
      }
      if (!isEditingText && event.altKey && event.key === 'ArrowLeft' && annale && selectedIndex > 0) {
        selectQuestion(annale.questions[selectedIndex - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annale, saveQuestion, selectQuestion, selectedIndex]);

  useEffect(() => {
    if (activeTab === 'source') loadSourceInfo();
  }, [activeTab, loadSourceInfo]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/captures" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft size={12} /> Retour
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-[650]">
              <FileText size={21} className="text-brand-700 dark:text-brand-500" />
              Atelier de correction
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedAnnaleId || ''}
              onChange={(e) => {
                const id = e.target.value || null;
                if (id) loadAnnale(id);
              }}
              className="h-9 min-w-[260px] rounded-input border border-input bg-input-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Ouvrir une annale complète...</option>
              {annales.map((item) => (
                <option key={item.id} value={item.id}>{item.title || item.id}</option>
              ))}
            </select>
            <button onClick={loadQueue} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-input border border-border bg-card px-3 text-sm hover:bg-muted disabled:opacity-60">
              {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Rafraîchir
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-4 rounded-input border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/40 dark:text-danger-500">
          {error}
        </div>
      )}

      <main className="grid min-h-[calc(100vh-74px)] grid-cols-1 gap-0 xl:grid-cols-[340px_minmax(420px,1fr)_420px]">
        <QueuePanel
          rows={filteredRows}
          rawRows={rows}
          statusFilter={statusFilter}
          sourceFilter={sourceFilter}
          categoryFilter={categoryFilter}
          queueSearch={queueSearch}
          categories={categories}
          selectedRow={selectedRow}
          onStatusFilter={setStatusFilter}
          onSourceFilter={setSourceFilter}
          onCategoryFilter={setCategoryFilter}
          onSearch={setQueueSearch}
          onSelect={(row) => {
            setSelectedRow(row);
            loadAnnale(row.annaleId, row.questionId);
          }}
        />

        <section className="border-r border-border bg-muted/40 p-4">
          {loadingAnnale && <WorkbenchSkeleton />}
          {!loadingAnnale && !annale && (
            <div className="flex min-h-[420px] items-center justify-center rounded-card border border-dashed border-border bg-card text-center">
              <div>
                <BookOpen className="mx-auto mb-3 text-muted-foreground" size={34} />
                <div className="text-sm font-medium">Sélectionne un signalement ou une annale</div>
                <div className="mt-1 text-xs text-muted-foreground">La prévisualisation complète apparaîtra ici.</div>
              </div>
            </div>
          )}
          {!loadingAnnale && annale && selectedQuestion && (
            <QuestionPreview
              annale={annale}
              question={selectedQuestion}
              validation={validation}
              selectedIndex={selectedIndex}
              onSelect={selectQuestion}
              onPrev={() => selectedIndex > 0 && selectQuestion(annale.questions[selectedIndex - 1].id)}
              onNext={() => selectedIndex < annale.questions.length - 1 && selectQuestion(annale.questions[selectedIndex + 1].id)}
              onMove={moveQuestion}
            />
          )}
        </section>

        <section className="bg-card p-4">
          {!draftQuestion ? (
            <div className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Aucune question sélectionnée.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Éditeur structurel</div>
                  <h2 className="font-mono text-lg font-[650]">{draftQuestion.id}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={suggestLocalPatch} className="inline-flex h-9 items-center gap-2 rounded-input border border-warn-100 bg-warn-50 px-3 text-sm text-warn-700 hover:bg-warn-100 dark:border-warn-700/50 dark:bg-warn-950/40 dark:text-warn-100">
                    <Wand2 size={15} /> Suggérer
                  </button>
                  <button onClick={() => saveQuestion(false)} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-input bg-foreground px-3 text-sm text-background hover:opacity-90 disabled:opacity-60">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Sauvegarder
                  </button>
                  <button onClick={() => saveQuestion(true)} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-input bg-success-700 px-3 text-sm text-white hover:bg-success-500 disabled:opacity-60">
                    <CheckCircle2 size={15} /> Sauver + résoudre
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 rounded-input bg-muted p-1">
                {[
                  ['content', 'Contenu'],
                  ['options', 'Options'],
                  ['series', 'Série'],
                  ['images', 'Images'],
                  ['source', 'Source'],
                  ['validation', 'Validation'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key as TabKey)}
                    className={`rounded-md px-3 py-1.5 text-sm ${activeTab === key ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'content' && (
                <ContentEditor question={draftQuestion} update={updateDraft} />
              )}
              {activeTab === 'options' && (
                <OptionsEditor
                  question={draftQuestion}
                  update={updateDraft}
                  updateOption={updateOption}
                  setQuestion={setDraftQuestion}
                />
              )}
              {activeTab === 'series' && (
                <SeriesEditor question={draftQuestion} update={updateDraft} />
              )}
              {activeTab === 'images' && (
                <ImagesEditor
                  annaleId={selectedAnnaleId}
                  question={draftQuestion}
                  uploading={uploadingImage}
                  onUpload={uploadImage}
                  onDelete={deleteImage}
                />
              )}
              {activeTab === 'source' && (
                <SourcePanel sourceInfo={sourceInfo} loading={sourceLoading} onReload={loadSourceInfo} />
              )}
              {activeTab === 'validation' && (
                <ValidationPanel
                  validation={validation}
                  issues={questionIssues}
                  onValidate={validateAnnale}
                  onAddQuestion={addQuestion}
                  onDeleteQuestion={deleteQuestion}
                />
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function QueuePanel(props: {
  rows: WorkRow[];
  rawRows: WorkRow[] | null;
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  categoryFilter: string;
  queueSearch: string;
  categories: [string, string][];
  selectedRow: WorkRow | null;
  onStatusFilter: (v: StatusFilter) => void;
  onSourceFilter: (v: SourceFilter) => void;
  onCategoryFilter: (v: string) => void;
  onSearch: (v: string) => void;
  onSelect: (row: WorkRow) => void;
}) {
  return (
    <aside className="border-r border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-[650]">File de travail</h2>
        <Badge className="border-border bg-muted text-muted-foreground">
          {props.rows.length}
        </Badge>
      </div>
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
          <input
            value={props.queueSearch}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="Rechercher..."
            className="h-9 w-full rounded-input border border-input bg-input-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={props.statusFilter} onChange={(e) => props.onStatusFilter(e.target.value as StatusFilter)} className="h-8 rounded-input border border-input bg-input-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring">
            <option value="open">Ouverts</option>
            <option value="resolved">Résolus</option>
            <option value="all">Tous</option>
          </select>
          <select value={props.sourceFilter} onChange={(e) => props.onSourceFilter(e.target.value as SourceFilter)} className="h-8 rounded-input border border-input bg-input-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring">
            <option value="all">Tout</option>
            <option value="reported">Signalés</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <select value={props.categoryFilter} onChange={(e) => props.onCategoryFilter(e.target.value)} className="h-8 w-full rounded-input border border-input bg-input-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring">
          <option value="all">Toutes catégories</option>
          {props.categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="mt-4 max-h-[calc(100vh-250px)] space-y-2 overflow-y-auto pr-1">
        {!props.rawRows && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        {props.rawRows && props.rows.length === 0 && (
          <div className="rounded-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun signalement dans ce filtre.
          </div>
        )}
        {props.rows.map((row) => {
          const selected = props.selectedRow?.source === row.source
            && props.selectedRow?.annaleId === row.annaleId
            && props.selectedRow?.questionId === row.questionId
            && props.selectedRow?.reportId === row.reportId;
          return (
            <button
              key={`${row.source}-${row.annaleId}-${row.questionId}-${row.reportId || 'auto'}`}
              onClick={() => props.onSelect(row)}
              className={`w-full rounded-card border p-3 text-left transition ${selected ? 'border-brand-500 bg-brand-50 dark:border-brand-700/50 dark:bg-brand-950/30' : 'border-border bg-muted/40 hover:bg-muted'}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium">{row.annaleTitle || row.annaleId}</span>
                <Badge className={row.source === 'reported' ? 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700/50 dark:bg-warn-950/30 dark:text-warn-100' : 'border-border bg-muted text-muted-foreground'}>
                  {row.source === 'reported' ? 'user' : 'auto'}
                </Badge>
              </div>
              <div className="font-mono text-xs text-muted-foreground">{row.annaleId} · {row.questionId}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.note || row.excerpt || row.categoryLabel}</div>
              {row.annaleOrphan && <div className="mt-2 text-xs text-danger-700 dark:text-danger-500">Annale introuvable</div>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function QuestionPreview(props: {
  annale: AdminAnnale;
  question: AdminQuestion;
  validation: ValidationReport | null;
  selectedIndex: number;
  onSelect: (qid: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { annale, question } = props;
  const issuesByQuestion = new Map<string, ValidationIssue[]>();
  for (const issue of props.validation?.issues || []) {
    if (!issue.questionId) continue;
    issuesByQuestion.set(issue.questionId, [...(issuesByQuestion.get(issue.questionId) || []), issue]);
  }
  const images = collectImages(question);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm text-muted-foreground">{annale.subject || 'Annale'} · {annale.year || 'année ?'} · révision {annale.revision || 0}</div>
          <h2 className="text-xl font-[650]">{annale.title || annale.id}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={props.onPrev} disabled={props.selectedIndex <= 0} className="rounded-input border border-border p-2 hover:bg-muted disabled:opacity-40"><ChevronLeft size={16} /></button>
          <span className="text-sm tabular-nums">{props.selectedIndex + 1} / {annale.questions.length}</span>
          <button onClick={props.onNext} disabled={props.selectedIndex >= annale.questions.length - 1} className="rounded-input border border-border p-2 hover:bg-muted disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {annale.questions.map((q, index) => {
          const issues = issuesByQuestion.get(q.id) || [];
          const hasError = issues.some((i) => i.severity === 'error');
          const hasWarning = issues.some((i) => i.severity === 'warning');
          return (
            <button
              key={q.id}
              onClick={() => props.onSelect(q.id)}
              className={`h-8 min-w-8 rounded-input border px-2 text-xs ${q.id === question.id ? 'border-brand-600 bg-brand-600 text-white' : hasError ? 'border-danger-100 bg-danger-50 text-danger-700' : hasWarning ? 'border-warn-100 bg-warn-50 text-warn-700' : 'border-border bg-card'}`}
              title={q.id}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <article className="rounded-card border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge className="border-border bg-muted text-muted-foreground">{question.questionType}</Badge>
          {question.seriesId && <Badge className="border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700/50 dark:bg-brand-950/30 dark:text-brand-100">{question.seriesFormat} {question.seriesPosition}/{question.seriesTotal}</Badge>}
          <button onClick={() => props.onMove(-1)} disabled={props.selectedIndex <= 0} className="ml-auto rounded-input border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">Monter</button>
          <button onClick={() => props.onMove(1)} disabled={props.selectedIndex >= annale.questions.length - 1} className="rounded-input border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">Descendre</button>
        </div>
        {question.vignette && (
          <div className="mb-4 rounded-input border border-brand-100 bg-brand-50 p-3 text-sm leading-relaxed text-brand-950 dark:border-brand-700/50 dark:bg-brand-950/30 dark:text-brand-100">
            {question.vignette}
          </div>
        )}
        <h3 className="whitespace-pre-wrap text-lg font-[650] leading-relaxed">{question.text}</h3>
        {images.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {images.map((img) => (
              <img key={img.filename} src={`/api/annales/${encodeURIComponent(annale.id)}/img/${encodeURIComponent(img.filename || '')}`} alt={img.label || img.filename || 'image'} className="max-h-80 rounded-input border border-border object-contain" />
            ))}
          </div>
        )}
        {question.options?.length ? (
          <div className="mt-5 space-y-2">
            {question.options.map((opt) => (
              <div key={opt.id} className={`flex gap-3 rounded-input border p-3 ${opt.correct ? 'border-success-100 bg-success-50 dark:border-success-700/50 dark:bg-success-950/30' : 'border-border bg-muted/40'}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card font-mono text-xs">{opt.id}</span>
                <span className="whitespace-pre-wrap text-sm">{opt.text}</span>
                {opt.correct && <CheckCircle2 className="ml-auto shrink-0 text-success-700 dark:text-success-500" size={16} />}
              </div>
            ))}
          </div>
        ) : question.expectedAnswer ? (
          <div className="mt-5 rounded-input border border-success-100 bg-success-50 p-3 text-sm text-success-950 dark:border-success-700/50 dark:bg-success-950/30 dark:text-success-100">
            Réponse attendue : {question.expectedAnswer}
          </div>
        ) : null}
        {question.correctionText && (
          <div className="mt-5 rounded-input border border-border bg-muted/50 p-3 text-sm leading-relaxed">
            <div className="mb-1 text-xs font-[650] uppercase text-muted-foreground">Correction</div>
            <div className="whitespace-pre-wrap">{question.correctionText}</div>
          </div>
        )}
      </article>
    </div>
  );
}

function ContentEditor({ question, update }: { question: AdminQuestion; update: (patch: Partial<AdminQuestion>) => void }) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Titre interne
        <input value={question.customTitle || ''} onChange={(e) => update({ customTitle: e.target.value })} className="mt-1 h-9 w-full rounded-input border border-input bg-input-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="block text-sm font-medium">Énoncé
        <textarea value={question.text || ''} onChange={(e) => update({ text: e.target.value })} rows={7} className="mt-1 w-full resize-y rounded-input border border-input bg-input-background p-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="block text-sm font-medium">Correction
        <textarea value={question.correctionText || ''} onChange={(e) => update({ correctionText: e.target.value })} rows={7} className="mt-1 w-full resize-y rounded-input border border-input bg-input-background p-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring" />
      </label>
    </div>
  );
}

function OptionsEditor(props: {
  question: AdminQuestion;
  update: (patch: Partial<AdminQuestion>) => void;
  updateOption: (index: number, patch: Partial<OptionItem>) => void;
  setQuestion: (fn: (q: AdminQuestion | null) => AdminQuestion | null) => void;
}) {
  const options = props.question.options || [];
  const isQcm = props.question.questionType === 'QRU' || props.question.questionType === 'QRM';
  const setOptions = (next: OptionItem[]) => props.update({ options: next.map((opt, i) => ({ ...opt, id: OPTION_IDS[i] })) });
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">Type de question
        <select
          value={props.question.questionType}
          onChange={(e) => {
            const nextType = e.target.value as QuestionType;
            props.update({ questionType: nextType, options: nextType === 'QRU' || nextType === 'QRM' ? options.length ? options : [{ id: 'A', text: '', correct: true }] : [] });
          }}
          className="mt-1 h-9 w-full rounded-input border border-input bg-input-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="QRU">QRU</option>
          <option value="QRM">QRM</option>
          <option value="QROC">QROC</option>
          <option value="ZONE">ZONE</option>
        </select>
      </label>

      {isQcm ? (
        <>
          <div className="space-y-2">
            {options.map((opt, index) => (
              <div key={`${opt.id}-${index}`} className="grid grid-cols-[34px_1fr_auto_auto_auto] items-center gap-2 rounded-input border border-border bg-muted/40 p-2">
                <span className="font-mono text-sm">{OPTION_IDS[index]}</span>
                <input value={opt.text || ''} onChange={(e) => props.updateOption(index, { text: e.target.value })} className="h-9 rounded-input border border-input bg-input-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <label className="inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={!!opt.correct} onChange={(e) => props.updateOption(index, { correct: e.target.checked })} />
                  juste
                </label>
                <button onClick={() => index > 0 && setOptions(moveItem(options, index, index - 1))} disabled={index === 0} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">↑</button>
                <button onClick={() => setOptions(options.filter((_, i) => i !== index))} className="rounded border border-danger-100 px-2 py-1 text-xs text-danger-700 hover:bg-danger-50 dark:border-danger-700/50 dark:text-danger-500"><X size={13} /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => options.length < OPTION_LIMIT && setOptions([...options, { id: '', text: '', correct: false }])} disabled={options.length >= OPTION_LIMIT} className="inline-flex items-center gap-2 rounded-input border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
              <Plus size={15} /> Option
            </button>
            <button onClick={() => props.update({ questionType: 'QROC', options: [], expectedAnswer: props.question.expectedAnswer || '' })} className="rounded-input border border-border px-3 py-2 text-sm hover:bg-muted">
              Convertir en QROC
            </button>
          </div>
        </>
      ) : (
        <label className="block text-sm font-medium">Réponse attendue
          <textarea value={props.question.expectedAnswer || ''} onChange={(e) => props.update({ expectedAnswer: e.target.value })} rows={5} className="mt-1 w-full resize-y rounded-input border border-input bg-input-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
      )}
    </div>
  );
}

function SeriesEditor({ question, update }: { question: AdminQuestion; update: (patch: Partial<AdminQuestion>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-medium">Format
          <select
            value={question.seriesFormat || ''}
            onChange={(e) => {
              const value = e.target.value as 'DP' | 'KFP' | '';
              if (!value) {
                update({ seriesId: null, seriesFormat: null, seriesPosition: null, seriesTotal: null, vignette: null });
              } else {
                update({ seriesFormat: value, seriesId: question.seriesId || `series-${question.id}` });
              }
            }}
            className="mt-1 h-9 w-full rounded-input border border-input bg-input-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">QI</option>
            <option value="DP">DP</option>
            <option value="KFP">KFP</option>
          </select>
        </label>
        <label className="block text-sm font-medium">seriesId
          <input value={question.seriesId || ''} onChange={(e) => update({ seriesId: e.target.value })} className="mt-1 h-9 w-full rounded-input border border-input bg-input-background px-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>
      <label className="block text-sm font-medium">Vignette clinique
        <textarea value={question.vignette || ''} onChange={(e) => update({ vignette: e.target.value })} rows={8} className="mt-1 w-full resize-y rounded-input border border-input bg-input-background p-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <button onClick={() => update({ seriesId: null, seriesFormat: null, seriesPosition: null, seriesTotal: null, vignette: null })} className="rounded-input border border-border px-3 py-2 text-sm hover:bg-muted">
        Repasser en QI
      </button>
    </div>
  );
}

function ImagesEditor(props: {
  annaleId: string | null;
  question: AdminQuestion;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (filename: string) => void;
}) {
  const images = collectImages(props.question);
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-border p-6 text-sm hover:bg-muted">
        {props.uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
        Ajouter une image
        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && props.onUpload(e.target.files[0])} />
      </label>
      {images.length === 0 && <div className="rounded-input border border-warn-100 bg-warn-50 p-3 text-sm text-warn-700 dark:border-warn-700/50 dark:bg-warn-950/30 dark:text-warn-100">Aucune image attachée.</div>}
      <div className="space-y-3">
        {images.map((img) => (
          <div key={img.filename} className="rounded-card border border-border p-3">
            {props.annaleId && img.filename && (
              <img src={`/api/annales/${encodeURIComponent(props.annaleId)}/img/${encodeURIComponent(img.filename)}`} alt={img.label || img.filename} className="max-h-52 rounded border border-border object-contain" />
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs">{img.filename}</span>
              {img.filename && <button onClick={() => props.onDelete(img.filename!)} className="inline-flex items-center gap-1 rounded-input border border-danger-100 px-2 py-1 text-xs text-danger-700 hover:bg-danger-50 dark:border-danger-700/50 dark:text-danger-500"><Trash2 size={12} /> Supprimer</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcePanel({ sourceInfo, loading, onReload }: { sourceInfo: SourceInfo | null; loading: boolean; onReload: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Sources disponibles</div>
          <div className="text-xs text-muted-foreground">Lecture seule : texte extrait localement et blocs QROC si présents.</div>
        </div>
        <button onClick={onReload} disabled={loading} className="inline-flex items-center gap-2 rounded-input border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Recharger
        </button>
      </div>
      {loading && <Skeleton className="h-40 rounded-lg" />}
      {!loading && !sourceInfo && (
        <div className="rounded-input border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aucune source chargée.
        </div>
      )}
      {!loading && sourceInfo && (
        <>
          {sourceInfo.excerpt && (
            <div className="rounded-card border border-brand-100 bg-brand-50 p-3 dark:border-brand-700/50 dark:bg-brand-950/30">
              <div className="mb-2 text-xs font-[650] uppercase text-brand-700 dark:text-brand-100">Extrait autour de la question · {sourceInfo.excerpt.file}</div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{sourceInfo.excerpt.text}</pre>
            </div>
          )}
          {sourceInfo.sourceBlocks?.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-[650] uppercase text-muted-foreground">Blocs QROC</div>
              {sourceInfo.sourceBlocks.slice(0, 8).map((block, index) => (
                <details key={`${block.draftId}-${block.id || index}`} className="rounded-input border border-border bg-muted/50 p-3">
                  <summary className="cursor-pointer text-sm font-medium">{block.title || block.id || `Bloc ${index + 1}`} · {block.draftId}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{block.cleanText}</pre>
                </details>
              ))}
            </div>
          )}
          {sourceInfo.files?.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-[650] uppercase text-muted-foreground">Fichiers extraits</div>
              {sourceInfo.files.map((file) => (
                <details key={file.name} className="rounded-input border border-border bg-muted/50 p-3">
                  <summary className="cursor-pointer text-sm font-medium">{file.name}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{file.text}</pre>
                </details>
              ))}
            </div>
          )}
          {sourceInfo.files?.length === 0 && sourceInfo.sourceBlocks?.length === 0 && (
            <div className="rounded-input border border-warn-100 bg-warn-50 p-3 text-sm text-warn-700 dark:border-warn-700/50 dark:bg-warn-950/30 dark:text-warn-100">
              Aucune source locale trouvée pour cette annale.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ValidationPanel(props: {
  validation: ValidationReport | null;
  issues: ValidationIssue[];
  onValidate: () => void;
  onAddQuestion: () => void;
  onDeleteQuestion: () => void;
}) {
  const issues = props.issues.length ? props.issues : props.validation?.issues || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={props.onValidate} className="rounded-input border border-border px-3 py-2 text-sm hover:bg-muted">Valider annale</button>
        <button onClick={props.onAddQuestion} className="inline-flex items-center gap-2 rounded-input border border-border px-3 py-2 text-sm hover:bg-muted"><Plus size={15} /> Ajouter question</button>
        <button onClick={props.onDeleteQuestion} className="inline-flex items-center gap-2 rounded-input border border-danger-100 px-3 py-2 text-sm text-danger-700 hover:bg-danger-50 dark:border-danger-700/50 dark:text-danger-500"><Trash2 size={15} /> Supprimer question</button>
      </div>
      {props.validation && (
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-input bg-danger-50 p-2 text-danger-700 dark:bg-danger-950/30 dark:text-danger-500">{props.validation.counts.error} erreurs</div>
          <div className="rounded-input bg-warn-50 p-2 text-warn-700 dark:bg-warn-950/30 dark:text-warn-100">{props.validation.counts.warning} warnings</div>
          <div className="rounded-input bg-muted p-2 text-muted-foreground">{props.validation.counts.info} infos</div>
        </div>
      )}
      <div className="space-y-2">
        {issues.length === 0 ? (
          <div className="rounded-input border border-success-100 bg-success-50 p-3 text-sm text-success-950 dark:border-success-700/50 dark:bg-success-950/30 dark:text-success-100">Aucun problème sur cette question.</div>
        ) : issues.map((issue, index) => (
          <div key={`${issue.code}-${index}`} className={`rounded-input border p-3 text-sm ${issue.severity === 'error' ? 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-500' : 'border-warn-100 bg-warn-50 text-warn-700 dark:border-warn-700/50 dark:bg-warn-950/30 dark:text-warn-100'}`}>
            <div className="font-mono text-xs">{issue.severity} · {issue.code} · {issue.questionId || 'annale'}</div>
            <div>{issue.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 rounded-lg" />
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}

function cloneQuestion(question: AdminQuestion | null): AdminQuestion | null {
  return question ? JSON.parse(JSON.stringify(question)) : null;
}

function normalizeBeforeSave(question: AdminQuestion): AdminQuestion {
  const next = cloneQuestion(question)!;
  const options = next.options || [];
  if (options.length === 0 && (next.expectedAnswer || next.questionType === 'QROC' || next.questionType === 'ZONE')) {
    next.questionType = next.questionType === 'ZONE' ? 'ZONE' : 'QROC';
    next.options = [];
    return next;
  }
  if (options.length > 0) {
    const correctCount = options.filter((opt) => opt.correct).length;
    next.questionType = correctCount > 1 ? 'QRM' : 'QRU';
    next.options = options.map((opt, index) => ({ ...opt, id: OPTION_IDS[index] }));
    next.expectedAnswer = null;
  }
  if (next.seriesFormat && !next.seriesId) next.seriesId = `series-${next.id}`;
  if (next.seriesId && !next.seriesFormat) next.seriesFormat = 'DP';
  return next;
}

function collectImages(question: AdminQuestion): QuestionImage[] {
  const byFilename = new Map<string, QuestionImage>();
  if (question.image) byFilename.set(question.image, { filename: question.image });
  for (const img of question.images || []) {
    if (img.filename) byFilename.set(img.filename, img);
  }
  return Array.from(byFilename.values());
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('lecture fichier impossible'));
    reader.readAsDataURL(file);
  });
}
