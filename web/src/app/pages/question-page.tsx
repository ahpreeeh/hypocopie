import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, HelpCircle, Image as ImageIcon, Trash2, Edit2, Check, X, Maximize2, BookOpen, Repeat2, ExternalLink } from 'lucide-react';
import { useData, Question } from '../data-context';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

import * as AlertDialog from '@radix-ui/react-alert-dialog';

export function QuestionPage() {
  const { id } = useParams<{ id: string }>();
  const { questions, updateQuestion, deleteQuestion, deleteImage } = useData();
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const question = useMemo(() => questions.find(q => q.id === id), [questions, id]);

  const seriesQuestions = useMemo(() => {
    if (!question?.seriesId) return [];
    return questions
      .filter(q => q.seriesId === question.seriesId)
      .sort((a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0));
  }, [questions, question?.seriesId]);

  if (!question) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Question introuvable</h2>
          <Link to="/captures" className="text-indigo-600 hover:underline">Retour à la liste</Link>
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    deleteQuestion(question.id);
    toast.success('Question supprimee');
    navigate('/captures');
  };

  const handleSaveChapter = (newChapter: string) => {
    updateQuestion(question.id, { chapter: newChapter || null });
    toast.success('Chapitre mis a jour');
  };

  const handleSaveTitle = (newTitle: string) => {
    updateQuestion(question.id, { customTitle: newTitle || null });
    toast.success('Titre mis a jour');
  };

  const handleDeleteImage = (imageId: string) => {
    deleteImage(question.id, imageId);
    toast.success('Image retiree');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-neutral-50 dark:bg-[#111]">
      {/* Top Header */}
      <header className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <Link to="/captures" className="p-2 -ml-2 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          
          <div className="flex items-center gap-2 text-sm">
             <span className="font-medium text-neutral-900 dark:text-neutral-100">{question.subject}</span>
             <span className="text-neutral-400">/</span>
             <EditableChapter 
               chapter={question.chapter} 
               onSave={handleSaveChapter} 
             />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog.Root open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <AlertDialog.Trigger asChild>
              <button className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors" title="Supprimer la question">
                <Trash2 size={18} />
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-neutral-900 rounded-xl p-6 shadow-xl z-50 w-full max-w-md border border-neutral-200 dark:border-neutral-800">
                <AlertDialog.Title className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                  Supprimer la question
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
                  Êtes-vous sûr de vouloir supprimer cette question ? Cette action est irréversible et supprimera également les images associées.
                </AlertDialog.Description>
                <div className="flex justify-end gap-3">
                  <AlertDialog.Cancel asChild>
                    <button className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors">
                      Annuler
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors">
                      Supprimer
                    </button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </header>

      {/* Main Content Area - Split view for Desktop */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Side: Navigation (Scrollable independently) */}
        <div className="w-[280px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 overflow-y-auto p-5">
          <div className="space-y-6">
            
            <EditableTitle 
              title={question.customTitle} 
              onSave={handleSaveTitle} 
              label="Titre du dossier"
            />

            {/* Series Navigation if applicable */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Navigation
              </h3>
              
              {question.seriesId && seriesQuestions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {seriesQuestions.map((sq) => (
                    <Link 
                      key={sq.id}
                      to={`/captures/q/${sq.id}`}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all ${
                        sq.id === question.id 
                          ? 'bg-indigo-600 text-white shadow-md' 
                          : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                          sq.id === question.id ? 'bg-white/20' : 'bg-neutral-100 dark:bg-neutral-700'
                        }`}>
                          {sq.seriesPosition}
                        </div>
                        <span className="font-medium truncate max-w-[150px]">Question {sq.seriesPosition}</span>
                      </div>
                      {sq.id !== question.id && (
                        <ChevronRight size={14} className="opacity-50" />
                      )}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-800 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
                  Question isolée (QI)
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Side: Main Content (Vignette + Question & Answers) */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111]">
           <div className="max-w-4xl mx-auto p-8 space-y-8 pb-32">

             {/* Unified Clinical Case (Dossier Progressif) */}
             {(question.vignette || (question.seriesId && seriesQuestions.some(sq => sq.addedVignette))) && (
               <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                 <div className="bg-neutral-50 dark:bg-neutral-900/50 px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <BookOpen size={16} className="text-indigo-600 dark:text-indigo-400" />
                     <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                       Cas clinique {question.seriesId ? "progressif" : ""}
                     </h3>
                   </div>
                 </div>
                 
                 <div className="p-5 text-[15px] leading-relaxed space-y-0 text-neutral-800 dark:text-neutral-200">
                   {question.vignette && (
                     <p className="whitespace-pre-wrap">{question.vignette}</p>
                   )}
                   
                   {question.seriesId && seriesQuestions.map((sq) => {
                     if ((sq.seriesPosition || 0) > (question.seriesPosition || 0)) return null;
                     if (!sq.addedVignette) return null;
                     
                     const isCurrent = sq.id === question.id;
                     
                     if (isCurrent) {
                       return (
                         <div key={sq.id} className="relative mt-4 -mx-5 px-5 py-4 bg-indigo-50 dark:bg-indigo-900/20 border-y border-indigo-100 dark:border-indigo-800/50">
                           <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500"></div>
                           <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-2">
                             <span className="relative flex h-2 w-2">
                               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                               <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                             </span>
                             Nouvelle information (Q{sq.seriesPosition})
                           </span>
                           <p className="whitespace-pre-wrap font-medium text-indigo-950 dark:text-indigo-100">
                             {sq.addedVignette}
                           </p>
                         </div>
                       );
                     }
                     
                     return (
                       <div key={sq.id} className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                         <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 block mb-1">
                           Information Q{sq.seriesPosition}
                         </span>
                         <p className="whitespace-pre-wrap opacity-90">
                           {sq.addedVignette}
                         </p>
                       </div>
                     );
                   })}
                 </div>
               </div>
             )}
              
              {/* Question Text */}
              <div className="space-y-4 pt-4">
                <div className="flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
                   <span className="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-medium">
                     {question.format}{question.seriesId ? ` — Q${question.seriesPosition}/${question.seriesTotal}` : ''}
                   </span>
                   <span>•</span>
                   <StatusBadge status={question.status} />
                   <span>•</span>
                   <span>Capturé le {format(new Date(question.capturedAt), 'dd MMM yyyy à HH:mm', { locale: fr })}</span>
                </div>
                <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 leading-tight">
                  {question.questionText}
                </h1>
              </div>

              {/* Images */}
              {question.images.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Imagerie & Annexes</h3>
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer">
                      <ImageIcon size={14} />
                      Ajouter une image
                      <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const url = URL.createObjectURL(e.target.files[0]);
                          updateQuestion(question.id, { images: [...question.images, { id: Math.random().toString(), url }] });
                          toast.success('Image ajoutee');
                        }
                      }} />
                    </label>
                  </div>
                  {question.images.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {question.images.map(img => (
                        <div key={img.id} className="relative group rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
                          <img src={img.url || ''} alt="Illustration de la question" className="w-full h-auto object-contain max-h-[300px]" loading="lazy" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <a href={img.url} target="_blank" rel="noreferrer" className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg backdrop-blur" title="Agrandir">
                              <Maximize2 size={20} />
                            </a>
                            <button onClick={() => handleDeleteImage(img.id)} className="p-2 bg-red-500/80 hover:bg-red-600 text-white rounded-lg backdrop-blur" title="Supprimer l'image">
                              <Trash2 size={20} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-400 italic">Aucune image associée.</div>
                  )}
                </div>
              )}

              {/* Options (QCM) */}
              {question.options && question.options.length > 0 && (
                <div className="space-y-3">
                  {question.options.map((opt, i) => {
                    // Logic for display:
                    // If option is correct: green border, green check if user checked it.
                    // If option is incorrect but user checked it: red border, red X
                    // If option is correct but user missed it: amber border/text indicating omission.
                    
                    let bg = "bg-white dark:bg-neutral-900";
                    let border = "border-neutral-200 dark:border-neutral-700";
                    let icon = null;
                    let textClass = "text-neutral-700 dark:text-neutral-300";

                    if (opt.isCorrect && opt.isChecked) {
                      bg = "bg-green-50 dark:bg-green-900/20";
                      border = "border-green-300 dark:border-green-800";
                      textClass = "text-green-800 dark:text-green-300 font-medium";
                      icon = <CheckCircle2 size={20} className="text-green-600 dark:text-green-500" />;
                    } else if (!opt.isCorrect && opt.isChecked) {
                      bg = "bg-red-50 dark:bg-red-900/20";
                      border = "border-red-300 dark:border-red-800";
                      textClass = "text-red-800 dark:text-red-300 font-medium line-through opacity-80";
                      icon = <X size={20} className="text-red-600 dark:text-red-500" />;
                    } else if (opt.isCorrect && !opt.isChecked) {
                      bg = "bg-amber-50 dark:bg-amber-900/10";
                      border = "border-amber-300 border-dashed dark:border-amber-800";
                      textClass = "text-amber-800 dark:text-amber-300 font-medium";
                      icon = <CheckCircle2 size={20} className="text-amber-500 opacity-60" />;
                    }

                    return (
                      <div key={opt.id} className={`flex items-start gap-4 p-4 rounded-xl border ${bg} ${border} transition-colors`}>
                        <div className="mt-0.5 shrink-0 w-6 flex justify-center">
                          {icon || <div className="w-5 h-5 rounded border border-neutral-300 dark:border-neutral-600" />}
                        </div>
                        <div className={`text-base leading-relaxed ${textClass}`}>
                          <span className="font-bold mr-2 opacity-50 text-sm uppercase">{String.fromCharCode(65 + i)}.</span>
                          {opt.text}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Free Answers */}
              {question.freeAnswers && question.freeAnswers.length > 0 && (
                <div className="space-y-6">
                  {question.freeAnswers.map((ans, i) => (
                    <div key={i} className="space-y-3">
                      <div className="p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                        <div className="text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400 mb-1">Votre réponse</div>
                        <div className="text-neutral-800 dark:text-neutral-200">{ans.userText}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50">
                        <div className="text-xs font-medium uppercase text-green-600 dark:text-green-500 mb-1">Réponse attendue</div>
                        <div className="text-green-900 dark:text-green-300 font-medium">{ans.expectedText}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Historique de revue */}
              {question.seenAgain && question.seenAgain.length > 0 && (
                <ReviewHistory question={question} />
              )}

              {/* Correction */}
              <div className="mt-12 pt-8 border-t border-neutral-200 dark:border-neutral-800">
                 <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
                   <BookOpen size={20} className="text-indigo-600 dark:text-indigo-400" />
                   Correction détaillée
                 </h2>
                 <div className="prose prose-neutral dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:text-[15px]">
                   {question.correctionText.split('\n').map((para, i) => (
                     <p key={i}>{para}</p>
                   ))}
                 </div>
              </div>

           </div>
        </div>
      </div>
    </div>
  );
}

function ReviewHistory({ question }: { question: Question }) {
  const entries = question.seenAgain || [];
  if (entries.length === 0) return null;

  // Historique complet : 1ère rencontre + revues, dans l'ordre chronologique
  const allEvents = [
    {
      at: question.capturedAt,
      url: null,
      status: question.status,
      selectedAnswers: question.selectedAnswers || [],
      label: '1ère rencontre',
    },
    ...entries.map((e, i) => ({
      at: e.at,
      url: e.url,
      status: e.status,
      selectedAnswers: e.selectedAnswers,
      label: `Revue ${i + 1}`,
    })),
  ];

  const statusEmoji = (s: string | null | undefined) => {
    if (s === 'correct') return '🟢';
    if (s === 'partial') return '🟠';
    if (s === 'wrong') return '🔴';
    return '⚪';
  };

  return (
    <div className="mt-10 pt-8 border-t border-neutral-200 dark:border-neutral-800">
      <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
        <Repeat2 size={20} className="text-indigo-600 dark:text-indigo-400" />
        Historique de revue
        <span className="text-sm font-normal text-neutral-500">
          — vue {allEvents.length} fois
        </span>
      </h2>

      {/* Progression rapide en emojis */}
      <div className="flex items-center gap-2 mb-6 text-2xl">
        {allEvents.map((e, i) => (
          <span key={i} title={`${e.label} : ${e.status || '?'}`}>
            {statusEmoji(e.status)}
          </span>
        ))}
      </div>

      {/* Timeline détaillée */}
      <div className="space-y-3">
        {allEvents.map((e, i) => (
          <div
            key={i}
            className="flex items-start gap-4 p-4 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
          >
            <div className="text-2xl shrink-0 mt-0.5">{statusEmoji(e.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {e.label}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {e.at ? format(new Date(e.at), 'dd MMM yyyy à HH:mm', { locale: fr }) : ''}
                </span>
                {e.status && <StatusBadge status={e.status} />}
              </div>
              {e.selectedAnswers && e.selectedAnswers.length > 0 && (
                <div className="text-sm text-neutral-600 dark:text-neutral-400">
                  Réponses cochées :{' '}
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">
                    {e.selectedAnswers.join(', ')}
                  </span>
                </div>
              )}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <ExternalLink size={12} />
                  Session d'origine
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string, icon: any, color: string, bg: string }> = {
    wrong: { label: 'Incorrecte', icon: AlertCircle, color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
    partial: { label: 'Partielle', icon: HelpCircle, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    unknown: { label: 'Indéterminée', icon: HelpCircle, color: 'text-neutral-700 dark:text-neutral-400', bg: 'bg-neutral-100 dark:bg-neutral-800' },
    correct: { label: 'Correcte', icon: CheckCircle2, color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' }
  };
  const { label, icon: Icon, color, bg } = config[status] || config.unknown;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${bg} ${color}`}>
      <Icon size={14} />
      {label}
    </span>
  )
}

function EditableChapter({ chapter, onSave }: { chapter: string | null, onSave: (c: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(chapter || '');

  if (isEditing) {
    return (
      <div className="flex gap-1 items-center">
        <input 
          autoFocus
          type="text" 
          value={val} 
          onChange={e => setVal(e.target.value)}
          placeholder="Chapitre..."
          className="w-32 px-2 py-0.5 text-sm rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-neutral-800 outline-none focus:ring-2 focus:ring-indigo-500 text-neutral-900 dark:text-neutral-100"
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(val); setIsEditing(false); }
            if (e.key === 'Escape') { setVal(chapter || ''); setIsEditing(false); }
          }}
          onBlur={() => { onSave(val); setIsEditing(false); }}
        />
      </div>
    )
  }

  return (
    <span 
      className="text-neutral-600 dark:text-neutral-300 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer flex items-center gap-1 group"
      onClick={() => setIsEditing(true)}
    >
      {chapter || 'Sans chapitre'}
      <Edit2 size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  )
}

function EditableTitle({ title, onSave, label }: { title: string | null, onSave: (t: string) => void, label: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(title || '');

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</label>
        <div className="flex gap-2">
          <input 
            autoFocus
            type="text" 
            value={val} 
            onChange={e => setVal(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-neutral-800 outline-none focus:ring-2 focus:ring-indigo-500"
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(val); setIsEditing(false); }
              if (e.key === 'Escape') { setVal(title || ''); setIsEditing(false); }
            }}
          />
          <button onClick={() => { onSave(val); setIsEditing(false); }} className="p-1.5 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800">
            <Check size={16} />
          </button>
          <button onClick={() => { setVal(title || ''); setIsEditing(false); }} className="p-1.5 bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700">
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex flex-col gap-1 cursor-pointer" onClick={() => setIsEditing(true)}>
      {title ? (
        <>
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</label>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-indigo-700 dark:text-indigo-400">{title}</h2>
            <Edit2 size={14} className="text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors py-2 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg px-4 bg-white/50 dark:bg-neutral-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
          <Edit2 size={14} />
          Ajouter un titre personnalisé
        </div>
      )}
    </div>
  )
}
