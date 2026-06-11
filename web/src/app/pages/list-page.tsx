import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router';
import { Search, Filter, X, Image as ImageIcon, BookOpen, AlertCircle, CheckCircle2, HelpCircle, ChevronRight, Hash, ChevronDown, History, Library, Layers, Calendar, ChevronUp, Repeat2, NotebookPen, PanelLeftClose, PanelLeftOpen, Menu } from 'lucide-react';
import { useData, Question, Status, Format } from '../data-context';
import { EmptyState } from '../components/design-primitives';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import logoImg from '../../imports/ChatGPT_Image_11_mai_2026__22_39_20.png';
import { format, isToday, isYesterday } from 'date-fns';
import { fr } from 'date-fns/locale';

type ViewMode = 'history' | 'subjects' | 'series';
type SortBy = 'newest' | 'oldest' | 'az';
const CAPTURES_SIDEBAR_KEY = 'hypocampus_captures_sidebar_open';

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
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(CAPTURES_SIDEBAR_KEY) !== '0');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

  useEffect(() => {
    localStorage.setItem(CAPTURES_SIDEBAR_KEY, sidebarOpen ? '1' : '0');
  }, [sidebarOpen]);

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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar Navigation & Filters */}
      <aside className={`${sidebarOpen ? 'w-[280px]' : 'w-16'} hidden md:flex border-r border-neutral-200 dark:border-neutral-800 flex-col bg-white dark:bg-[#111] z-10 flex-shrink-0 transition-[width] duration-200 ease-out`}>
        <div className={`${sidebarOpen ? 'px-4 justify-between' : 'px-2 justify-center'} h-16 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 shrink-0`}>
          <div className={`${sidebarOpen ? 'flex' : 'hidden'} items-center gap-2 font-medium text-sm tracking-tight text-neutral-900 dark:text-white`}>
            <NotebookPen size={16} className="text-indigo-600 dark:text-indigo-400" />
            Cahier d'erreurs
          </div>
          <button
            onClick={() => setSidebarOpen((value) => !value)}
            className="p-2 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
            title={sidebarOpen ? 'Reduire les filtres' : 'Afficher les filtres'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        <div className={`${sidebarOpen ? 'p-4 space-y-6' : 'p-2 space-y-2'} flex-1 overflow-y-auto`}>
          
          {/* Navigation Views */}
          <div className="space-y-1">
            {sidebarOpen && <h3 className="px-3 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">Bibliothèque</h3>}
            <NavItem icon={Calendar} label="Récents (Jours)" active={viewMode === 'history'} onClick={() => setViewMode('history')} compact={!sidebarOpen} />
            <NavItem icon={Library} label="Par Matière" active={viewMode === 'subjects'} onClick={() => setViewMode('subjects')} compact={!sidebarOpen} />
            <NavItem icon={Layers} label="Annales & Séries" active={viewMode === 'series'} onClick={() => setViewMode('series')} compact={!sidebarOpen} />
          </div>

          <div className={`${sidebarOpen ? '' : 'hidden'} h-px bg-neutral-200 dark:bg-neutral-800 w-full`} />

          {/* Filters Section (Collapsible or just clean) */}
          <div className={`${sidebarOpen ? 'space-y-3' : 'hidden'}`}>
            <button 
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors"
            >
              <div className="flex items-center gap-2">
                <Filter size={16} className={hasActiveFilters ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500"} />
                Filtres {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
              </div>
              {filtersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {filtersOpen && (
              <div className="px-3 space-y-4 pt-2">
                {hasActiveFilters && (
                  <button onClick={resetFilters} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    Réinitialiser les filtres
                  </button>
                )}

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

                <div className="h-px bg-neutral-200 dark:bg-neutral-800 w-full my-4" />
                
                <SelectField label="Trier par" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                  <option value="newest">Plus récentes d'abord</option>
                  <option value="oldest">Plus anciennes d'abord</option>
                  <option value="az">Matière (A→Z)</option>
                </SelectField>
              </div>
            )}
          </div>
        </div>
        
        <div className={`${sidebarOpen ? 'p-4' : 'p-2 text-center'} border-t border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50`}>
          {sidebarOpen
            ? `${filteredQuestions.length} question${filteredQuestions.length !== 1 ? 's' : ''} au total`
            : filteredQuestions.length}
        </div>
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-sm gap-0 p-0">
          <SheetHeader className="border-b border-neutral-200 dark:border-neutral-800">
            <SheetTitle className="text-left text-base">Cahier d'erreurs</SheetTitle>
          </SheetHeader>
          <div className="h-full overflow-y-auto bg-white p-4 dark:bg-neutral-900">
            <div className="mb-5 flex items-center justify-between">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {filteredQuestions.length} question{filteredQuestions.length !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Bibliothèque</h3>
              <NavItem icon={Calendar} label="Récents (Jours)" active={viewMode === 'history'} onClick={() => { setViewMode('history'); setMobileSidebarOpen(false); }} />
              <NavItem icon={Library} label="Par Matière" active={viewMode === 'subjects'} onClick={() => { setViewMode('subjects'); setMobileSidebarOpen(false); }} />
              <NavItem icon={Layers} label="Annales & Séries" active={viewMode === 'series'} onClick={() => { setViewMode('series'); setMobileSidebarOpen(false); }} />
            </div>

            <div className="my-5 h-px bg-neutral-200 dark:bg-neutral-800" />

            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  <Filter size={16} className={hasActiveFilters ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500"} />
                  Filtres
                </div>
                {hasActiveFilters && (
                  <button onClick={resetFilters} className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    Réinitialiser
                  </button>
                )}
              </div>
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
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-neutral-50 dark:bg-[#111] overflow-hidden">
        {/* Top Search Bar */}
        <div className="h-16 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-between shrink-0">
           <button
             onClick={() => setMobileSidebarOpen(true)}
             className="mr-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-800 md:hidden"
             title="Ouvrir les filtres"
           >
             <Menu size={18} />
           </button>
           <div className="relative max-w-xl w-full">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
             <input 
               type="text" 
               value={search}
               onChange={e => setSearch(e.target.value)}
               placeholder="Rechercher dans les questions, vignettes, options..."
               className="w-full pl-10 pr-10 py-2.5 rounded-full border-none bg-neutral-100 dark:bg-neutral-800 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-neutral-200 transition-shadow"
             />
             {search && (
               <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1">
                 <X size={14} />
               </button>
             )}
           </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-5xl mx-auto">
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
                    className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 transition-all duration-150 hover:bg-indigo-100 active:scale-95 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
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
                    <div key={groupName} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden shadow-sm">
                      <button 
                        onClick={() => toggleGroup(groupName)}
                        className="w-full flex items-center justify-between p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-md ${isExpanded ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>
                            {viewMode === 'history' ? <Calendar size={18} /> : viewMode === 'subjects' ? <Library size={18} /> : <Layers size={18} />}
                          </div>
                          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                            {groupName}
                          </h2>
                          <span className="px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                            {qs.length} question{qs.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-neutral-400">
                          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="p-4 pt-0 border-t border-neutral-100 dark:border-neutral-800/50">
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

function NavItem({ icon: Icon, label, active, onClick, compact = false }: { icon: any, label: string, active: boolean, onClick: () => void, compact?: boolean }) {
  return (
    <button 
      onClick={onClick}
      title={label}
      className={`w-full flex items-center ${compact ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active 
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400' 
          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
      }`}
    >
      <Icon size={18} className={active ? 'text-indigo-600 dark:text-indigo-400' : 'text-neutral-400'} />
      {!compact && label}
    </button>
  )
}

function SelectField({ label, value, onChange, children }: { label: string, value: string, onChange: (e: any) => void, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-neutral-600 dark:text-neutral-400">{label}</label>
      <select 
        value={value} 
        onChange={onChange}
        className="w-full px-3 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none appearance-none dark:text-neutral-200 cursor-pointer"
      >
        {children}
      </select>
    </div>
  )
}

function QuestionCard({ question: q }: { question: Question }) {
  const statusConfig = {
    wrong: { icon: AlertCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
    partial: { icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    unknown: { icon: HelpCircle, color: 'text-neutral-600 dark:text-neutral-400', bg: 'bg-neutral-100 dark:bg-neutral-800' },
    correct: { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' }
  };

  const StatusIcon = statusConfig[q.status].icon;

  return (
    <Link to={`/captures/q/${q.id}`} className="block group">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 transition-all hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md dark:hover:shadow-indigo-900/20">
        
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${statusConfig[q.status].bg} ${statusConfig[q.status].color}`}>
              <StatusIcon size={14} />
              {q.status === 'wrong' ? 'Incorrecte' : q.status === 'partial' ? 'Partielle' : q.status === 'correct' ? 'Correcte' : 'Indéterminée'}
            </span>
            
            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
              {q.format}
              {q.seriesId && q.seriesTotal ? ` (${q.seriesPosition}/${q.seriesTotal})` : ''}
            </span>

            <div className="flex items-center text-xs text-neutral-500 dark:text-neutral-400 gap-1.5 ml-2">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{q.subject}</span>
              {q.chapter && (
                <>
                  <ChevronRight size={12} className="opacity-50" />
                  <span>{q.chapter}</span>
                </>
              )}
            </div>
          </div>
          
          <div className="text-xs text-neutral-400 whitespace-nowrap">
            {format(new Date(q.capturedAt), 'dd MMM yyyy', { locale: fr })}
          </div>
        </div>

        {q.customTitle && (
          <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">
            {q.customTitle}
          </div>
        )}

        <h3 className="text-base text-neutral-900 dark:text-neutral-100 font-medium leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
          {q.questionText}
        </h3>

        <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          {q.images.length > 0 && (
            <div className="flex items-center gap-1">
              <ImageIcon size={14} />
              <span>{q.images.length} image{q.images.length > 1 ? 's' : ''}</span>
            </div>
          )}
          {q.seenAgain && q.seenAgain.length > 0 && (
            <div className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
              <Repeat2 size={14} />
              <span>Revue {q.seenAgain.length}x</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
