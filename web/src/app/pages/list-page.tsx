import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router';
import { Search, Filter, X, Image as ImageIcon, AlertCircle, CheckCircle2, HelpCircle, ChevronRight, ChevronDown, Library, Layers, Calendar, ChevronUp, Repeat2, NotebookPen } from 'lucide-react';
import { useData, Question, Status, Format } from '../data-context';
import { EmptyState, PageHeader } from '../components/design-primitives';
import { SegmentedControl } from '../components/ui/segmented-control';
import { format, isToday, isYesterday } from 'date-fns';
import { fr } from 'date-fns/locale';

type ViewMode = 'history' | 'subjects' | 'series';
type SortBy = 'newest' | 'oldest' | 'az';

export function ListPage() {
  const { questions } = useData();

  const [viewMode, setViewMode] = useState<ViewMode>('history');
  const [search, setSearch] = useState('');
  // Debounce de la recherche : on filtre sur la valeur retardée (250ms) pour
  // éviter de re-parcourir toutes les captures à chaque frappe quand la liste
  // grandit (>1000 items). L'input reste contrôlé sur `search` pour la
  // réactivité visuelle.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  
  // Filters
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [filterFormat, setFilterFormat] = useState<Format | 'all'>('all');
  const [filterHasImage, setFilterHasImage] = useState<boolean | 'all'>('all');
  const [filterSubject, setFilterSubject] = useState<string | 'all'>('all');
  const [filterChapter, setFilterChapter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Accordion state (expanded groups)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Subjects and chapters for filtering
  const subjects = useMemo(() => Array.from(new Set(questions.map(q => q.subject))).sort(), [questions]);

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      // Filters
      if (filterStatus !== 'all' && q.status !== filterStatus) return false;
      if (filterFormat !== 'all' && q.format !== filterFormat) return false;
      if (filterHasImage !== 'all') {
        if (filterHasImage === true && q.images.length === 0) return false;
        if (filterHasImage === false && q.images.length > 0) return false;
      }
      if (filterSubject !== 'all' && q.subject !== filterSubject) return false;
      if (filterChapter !== 'all' && q.chapter !== filterChapter) return false;

      // Search
      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase();
        const searchFields = [
          q.questionText,
          q.vignette,
          q.correctionText,
          q.subject,
          q.chapter,
          q.customTitle,
          q.options?.map(o => o.text).join(' '),
          q.freeAnswers?.map(a => a.userText + ' ' + a.expectedText).join(' ')
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchFields.includes(query)) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
      if (sortBy === 'oldest') return new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
      if (sortBy === 'az') return a.subject.localeCompare(b.subject);
      return 0;
    });
  }, [questions, filterStatus, filterFormat, filterHasImage, filterSubject, filterChapter, debouncedSearch, sortBy]);

  const resetFilters = () => {
    setFilterStatus('all');
    setFilterFormat('all');
    setFilterHasImage('all');
    setFilterSubject('all');
    setFilterChapter('all');
    setSearch('');
  };

  const hasActiveFilters = filterStatus !== 'all' || filterFormat !== 'all' || filterHasImage !== 'all' || filterSubject !== 'all' || filterChapter !== 'all' || search !== '';

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    
    if (viewMode === 'history') {
      filteredQuestions.forEach(q => {
        const date = new Date(q.capturedAt);
        let key = format(date, 'dd MMMM yyyy', { locale: fr });
        if (isToday(date)) key = "Aujourd'hui";
        else if (isYesterday(date)) key = "Hier";
        
        if (!groups[key]) groups[key] = [];
        groups[key].push(q);
      });
      // Sort groups by date descending is naturally handled if questions are already sorted by 'newest'
    } else if (viewMode === 'subjects') {
      filteredQuestions.forEach(q => {
        const key = q.subject || 'Sans matière';
        if (!groups[key]) groups[key] = [];
        groups[key].push(q);
      });
    } else if (viewMode === 'series') {
      filteredQuestions.filter(q => q.format !== 'QI').forEach(q => {
        const key = q.customTitle || q.seriesId || 'Série sans nom';
        if (!groups[key]) groups[key] = [];
        groups[key].push(q);
      });
    }

    return groups;
  }, [filteredQuestions, viewMode]);

  useEffect(() => {
    const keys = Object.keys(groupedQuestions);
    if (keys.length > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set([keys[0]]));
    }
  }, [groupedQuestions]);

  const viewModeLabel = viewMode === 'history' ? 'vue chronologique' : viewMode === 'subjects' ? 'vue par matière' : 'vue par série';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader
        title="Cahier d'erreurs"
        description={`${filteredQuestions.length} question${filteredQuestions.length !== 1 ? 's' : ''} · ${viewModeLabel}`}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une question…"
              className="w-full rounded-input border border-border bg-input-background py-2 pl-9 pr-8 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X size={13} />
              </button>
            )}
          </div>
        }
      />

      {/* Barre d'outils : vue + filtres inline (remplace l'ancienne sidebar interne) */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-2.5">
          <SegmentedControl
            ariaLabel="Vue du cahier"
            value={viewMode}
            onChange={(mode) => setViewMode(mode)}
            options={[
              { value: 'history', label: 'Récents' },
              { value: 'subjects', label: 'Matières' },
              { value: 'series', label: 'Séries' },
            ]}
          />
          <div className="flex-1" />
          {hasActiveFilters && (
            <button onClick={resetFilters} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-100">
              Réinitialiser
            </button>
          )}
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`inline-flex items-center gap-1.5 rounded-input border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              filtersOpen || hasActiveFilters
                ? 'border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-700/40 dark:bg-brand-950/40 dark:text-brand-100'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Filter size={14} />
            Filtres
            {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        {filtersOpen && (
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 px-6 pb-4 md:grid-cols-3 lg:grid-cols-6">
            <SelectField label="Statut" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
              <option value="all">Tous les statuts</option>
              <option value="wrong">Incorrecte</option>
              <option value="partial">Partielle</option>
              <option value="unknown">Indéterminée</option>
              <option value="correct">Correcte</option>
            </SelectField>
            <SelectField label="Format" value={filterFormat} onChange={e => setFilterFormat(e.target.value as any)}>
              <option value="all">Tous les formats</option>
              <option value="QI">Questions Isolées (QI)</option>
              <option value="DP">Dossiers Progressifs (DP)</option>
              <option value="KFP">Key Feature Problems (KFP)</option>
            </SelectField>
            <SelectField label="Matière" value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
              <option value="all">Toutes les matières</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </SelectField>
            {filterSubject !== 'all' && (
              <SelectField label="Chapitre" value={filterChapter} onChange={e => setFilterChapter(e.target.value)}>
                <option value="all">Tous les chapitres</option>
                {Array.from(new Set(questions.filter(q => q.subject === filterSubject && q.chapter).map(q => q.chapter))).map(c =>
                  <option key={c!} value={c!}>{c}</option>
                )}
              </SelectField>
            )}
            <SelectField label="Image" value={filterHasImage.toString()} onChange={e => setFilterHasImage(e.target.value === 'all' ? 'all' : e.target.value === 'true')}>
              <option value="all">Indifférent</option>
              <option value="true">Avec image(s)</option>
              <option value="false">Sans image</option>
            </SelectField>
            <SelectField label="Trier par" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="newest">Plus récentes d'abord</option>
              <option value="oldest">Plus anciennes d'abord</option>
              <option value="az">Matière (A→Z)</option>
            </SelectField>
          </div>
        )}
      </div>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="mx-auto max-w-6xl">
            {filteredQuestions.length === 0 ? (
              <EmptyState
                icon={questions.length === 0 ? NotebookPen : Search}
                title={questions.length === 0 ? 'Aucune question capturee' : 'Aucun resultat'}
                description={
                  questions.length === 0
                    ? "Les questions capturees depuis l'extension apparaitront ici."
                    : 'Modifie les filtres ou la recherche pour retrouver des questions.'
                }
                action={hasActiveFilters ? (
                  <button
                    onClick={resetFilters}
                    className="rounded-input bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-100"
                  >
                    Reinitialiser les filtres
                  </button>
                ) : undefined}
              />
            ) : (
              <div className="space-y-4 pb-20">
                {Object.entries(groupedQuestions).map(([groupName, qs]) => {
                  const isExpanded = expandedGroups.has(groupName);
                  return (
                    <div key={groupName} className="overflow-hidden rounded-card border border-border bg-card shadow-[var(--shadow-card)]">
                      <button 
                        onClick={() => toggleGroup(groupName)}
                        className="flex w-full items-center justify-between p-4 transition-colors hover:bg-muted/60"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`rounded-input p-1.5 ${isExpanded ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-100' : 'bg-muted text-muted-foreground'}`}>
                            {viewMode === 'history' ? <Calendar size={18} /> : viewMode === 'subjects' ? <Library size={18} /> : <Layers size={18} />}
                          </div>
                          <h2 className="text-lg font-medium text-foreground">
                            {groupName}
                          </h2>
                          <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {qs.length} question{qs.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="border-t border-border p-4 pt-0">
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                            {qs.map(q => (
                              <QuestionCard key={q.id} question={q} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SelectField({ label, value, onChange, children }: { label: string, value: string, onChange: (e: any) => void, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-muted-foreground">{label}</label>
      <select 
        value={value} 
        onChange={onChange}
        className="w-full cursor-pointer appearance-none rounded-input border border-input bg-input-background px-3 py-2 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-ring"
      >
        {children}
      </select>
    </div>
  )
}

function QuestionCard({ question: q }: { question: Question }) {
  const statusConfig = {
    wrong: { icon: AlertCircle, color: 'text-danger-700 dark:text-danger-100', bg: 'bg-danger-50 dark:bg-danger-950/40' },
    partial: { icon: HelpCircle, color: 'text-warn-700 dark:text-warn-100', bg: 'bg-warn-50 dark:bg-warn-950/40' },
    unknown: { icon: HelpCircle, color: 'text-muted-foreground', bg: 'bg-muted' },
    correct: { icon: CheckCircle2, color: 'text-success-700 dark:text-success-100', bg: 'bg-success-50 dark:bg-success-950/40' }
  };

  const StatusIcon = statusConfig[q.status].icon;

  return (
    <Link to={`/captures/q/${q.id}`} className="block group">
      <div className="rounded-card border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand-100">
        
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs font-medium ${statusConfig[q.status].bg} ${statusConfig[q.status].color}`}>
              <StatusIcon size={14} />
              {q.status === 'wrong' ? 'Incorrecte' : q.status === 'partial' ? 'Partielle' : q.status === 'correct' ? 'Correcte' : 'Indéterminée'}
            </span>
            
            <span className="inline-flex items-center rounded-input bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {q.format}
              {q.seriesId && q.seriesTotal ? ` (${q.seriesPosition}/${q.seriesTotal})` : ''}
            </span>

            <div className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{q.subject}</span>
              {q.chapter && (
                <>
                  <ChevronRight size={12} className="opacity-50" />
                  <span>{q.chapter}</span>
                </>
              )}
            </div>
          </div>
          
          <div className="whitespace-nowrap text-xs text-muted-foreground">
            {format(new Date(q.capturedAt), 'dd MMM yyyy', { locale: fr })}
          </div>
        </div>

        {q.customTitle && (
          <div className="mb-1 text-sm font-medium text-brand-700">
            {q.customTitle}
          </div>
        )}

        <h3 className="line-clamp-2 text-base font-medium leading-snug text-foreground transition-colors group-hover:text-brand-700">
          {q.questionText}
        </h3>

        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          {q.images.length > 0 && (
            <div className="flex items-center gap-1">
              <ImageIcon size={14} />
              <span>{q.images.length} image{q.images.length > 1 ? 's' : ''}</span>
            </div>
          )}
          {q.seenAgain && q.seenAgain.length > 0 && (
            <div className="flex items-center gap-1 font-medium text-brand-700">
              <Repeat2 size={14} />
              <span>Revue {q.seenAgain.length}x</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
