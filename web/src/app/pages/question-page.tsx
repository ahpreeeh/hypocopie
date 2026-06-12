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
          <h2 className="text-xl font-medium mb-2 text-foreground">Question introuvable</h2>
          <Link to="/captures" className="text-brand-700 hover:underline dark:text-brand-500">Retour à la liste</Link>
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
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Top Header */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <Link to="/captures" className="p-2 -ml-2 rounded-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowLeft size={20} />
          </Link>
          
          <div className="flex items-center gap-2 text-sm">
             <span className="font-medium text-foreground">{question.subject}</span>
             <span className="text-muted-foreground/60">/</span>
             <EditableChapter 
               chapter={question.chapter} 
               onSave={handleSaveChapter} 
             />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog.Root open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <AlertDialog.Trigger asChild>
              <button className="p-2 text-muted-foreground hover:text-danger-700 hover:bg-danger-50 dark:hover:bg-danger-950/30 rounded-input transition-colors" title="Supprimer la question">
                <Trash2 size={18} />
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-card p-6 shadow-xl">
                <AlertDialog.Title className="text-lg font-medium text-foreground mb-2">
                  Supprimer la question
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-muted-foreground mb-6">
                  Êtes-vous sûr de vouloir supprimer cette question ? Cette action est irréversible et supprimera également les images associées.
                </AlertDialog.Description>
                <div className="flex justify-end gap-3">
                  <AlertDialog.Cancel asChild>
                    <button className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-input transition-colors">
                      Annuler
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-white bg-danger-700 hover:bg-danger-500 rounded-input transition-colors">
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
        <div className="w-[280px] shrink-0 border-r border-border bg-card/70 overflow-y-auto p-5">
          <div className="space-y-6">
            
            <EditableTitle 
              title={question.customTitle} 
              onSave={handleSaveTitle} 
              label="Titre du dossier"
            />

            {/* Series Navigation if applicable */}
            <div className="space-y-3">
              <h3 className="text-xs font-[650] uppercase tracking-wider text-muted-foreground">
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
                          ? 'bg-brand-600 text-white shadow-md'
                          : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground border border-border'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-[650] ${
                          sq.id === question.id ? 'bg-primary-foreground/20' : 'bg-muted'
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
                <div className="text-sm text-muted-foreground bg-card p-3 rounded-input border border-border">
                  Question isolée (QI)
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Side: Main Content (Vignette + Question & Answers) */}
        <div className="flex-1 overflow-y-auto bg-background">
           <div className="max-w-4xl mx-auto p-8 space-y-8 pb-32">

             {/* Unified Clinical Case (Dossier Progressif) */}
             {(question.vignette || (question.seriesId && seriesQuestions.some(sq => sq.addedVignette))) && (
               <div className="bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col">
                 <div className="bg-muted/50 px-5 py-3 border-b border-border flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <BookOpen size={16} className="text-brand-700 dark:text-brand-500" />
                     <h3 className="text-xs font-[650] uppercase tracking-wider text-muted-foreground">
                       Cas clinique {question.seriesId ? "progressif" : ""}
                     </h3>
                   </div>
                 </div>
                 
                 <div className="p-5 text-[15px] leading-relaxed space-y-0 text-foreground">
                   {question.vignette && (
                     <p className="whitespace-pre-wrap">{question.vignette}</p>
                   )}
                   
                   {question.seriesId && seriesQuestions.map((sq) => {
                     if ((sq.seriesPosition || 0) > (question.seriesPosition || 0)) return null;
                     if (!sq.addedVignette) return null;
                     
                     const isCurrent = sq.id === question.id;
                     
                     if (isCurrent) {
                       return (
                         <div key={sq.id} className="relative mt-4 -mx-5 px-5 py-4 bg-brand-50 dark:bg-brand-950/30 border-y border-brand-100 dark:border-brand-700/40">
                           <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-600"></div>
                           <span className="flex items-center gap-1.5 text-[11px] font-[650] uppercase tracking-wider text-brand-700 dark:text-brand-100 mb-2">
                             <span className="relative flex h-2 w-2">
                               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75"></span>
                               <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-600"></span>
                             </span>
                             Nouvelle information (Q{sq.seriesPosition})
                           </span>
                           <p className="whitespace-pre-wrap font-medium text-brand-950 dark:text-brand-100">
                             {sq.addedVignette}
                           </p>
                         </div>
                       );
                     }
                     
                     return (
                       <div key={sq.id} className="mt-4 pt-4 border-t border-border">
                         <span className="text-[11px] font-[650] uppercase tracking-wider text-muted-foreground block mb-1">
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
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                   <span className="px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
                     {question.format}{question.seriesId ? ` — Q${question.seriesPosition}/${question.seriesTotal}` : ''}
                   </span>
                   <span>•</span>
                   <StatusBadge status={question.status} />
                   <span>•</span>
                   <span>Capturé le {format(new Date(question.capturedAt), 'dd MMM yyyy à HH:mm', { locale: fr })}</span>
                </div>
                <h1 className="text-2xl font-[650] text-foreground leading-tight">
                  {question.questionText}
                </h1>
              </div>

              {/* Images */}
              {question.images.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Imagerie & Annexes</h3>
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-100 bg-brand-50 dark:bg-brand-950/30 rounded-input hover:bg-brand-100 transition-colors cursor-pointer">
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
                        <div key={img.id} className="relative group rounded-input overflow-hidden border border-border bg-muted">
                          <img src={img.url || ''} alt="Illustration de la question" className="w-full h-auto object-contain max-h-[300px]" loading="lazy" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <a href={img.url} target="_blank" rel="noreferrer" className="p-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-white rounded-input backdrop-blur" title="Agrandir">
                              <Maximize2 size={20} />
                            </a>
                            <button onClick={() => handleDeleteImage(img.id)} className="p-2 bg-danger-500/80 hover:bg-danger-700 text-white rounded-input backdrop-blur" title="Supprimer l'image">
                              <Trash2 size={20} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">Aucune image associée.</div>
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
                    
                    let bg = "bg-card";
                    let border = "border-border";
                    let icon = null;
                    let textClass = "text-muted-foreground";

                    if (opt.isCorrect && opt.isChecked) {
                      bg = "bg-success-50 dark:bg-success-950/30";
                      border = "border-success-100 dark:border-success-700/50";
                      textClass = "text-success-950 dark:text-success-100 font-medium";
                      icon = <CheckCircle2 size={20} className="text-success-700 dark:text-success-500" />;
                    } else if (!opt.isCorrect && opt.isChecked) {
                      bg = "bg-danger-50 dark:bg-danger-950/30";
                      border = "border-danger-100 dark:border-danger-700/50";
                      textClass = "text-danger-950 dark:text-danger-100 font-medium line-through opacity-80";
                      icon = <X size={20} className="text-danger-700 dark:text-danger-500" />;
                    } else if (opt.isCorrect && !opt.isChecked) {
                      bg = "bg-warn-50 dark:bg-warn-950/30";
                      border = "border-warn-100 border-dashed dark:border-warn-700/50";
                      textClass = "text-warn-950 dark:text-warn-100 font-medium";
                      icon = <CheckCircle2 size={20} className="text-warn-500 opacity-70" />;
                    }

                    return (
                      <div key={opt.id} className={`flex items-start gap-4 p-4 rounded-xl border ${bg} ${border} transition-colors`}>
                        <div className="mt-0.5 shrink-0 w-6 flex justify-center">
                          {icon || <div className="w-5 h-5 rounded border border-border" />}
                        </div>
                        <div className={`text-base leading-relaxed ${textClass}`}>
                          <span className="font-[650] mr-2 opacity-50 text-sm uppercase">{String.fromCharCode(65 + i)}.</span>
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
                      <div className="p-4 rounded-input bg-muted/60 border border-border">
                        <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Votre réponse</div>
                        <div className="text-foreground">{ans.userText}</div>
                      </div>
                      <div className="p-4 rounded-input bg-success-50 dark:bg-success-950/30 border border-success-100 dark:border-success-700/50">
                        <div className="text-xs font-medium uppercase text-success-700 dark:text-success-500 mb-1">Réponse attendue</div>
                        <div className="text-success-950 dark:text-success-100 font-medium">{ans.expectedText}</div>
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
              <div className="mt-12 pt-8 border-t border-border">
                 <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                   <BookOpen size={20} className="text-brand-700 dark:text-brand-500" />
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
    <div className="mt-10 pt-8 border-t border-border">
      <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
        <Repeat2 size={20} className="text-brand-700 dark:text-brand-500" />
        Historique de revue
        <span className="text-sm font-normal text-muted-foreground">
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
            className="flex items-start gap-4 p-4 rounded-input bg-card border border-border"
          >
            <div className="text-2xl shrink-0 mt-0.5">{statusEmoji(e.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-medium text-foreground">
                  {e.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.at ? format(new Date(e.at), 'dd MMM yyyy à HH:mm', { locale: fr }) : ''}
                </span>
                {e.status && <StatusBadge status={e.status} />}
              </div>
              {e.selectedAnswers && e.selectedAnswers.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  Réponses cochées :{' '}
                  <span className="font-medium text-foreground">
                    {e.selectedAnswers.join(', ')}
                  </span>
                </div>
              )}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-xs text-brand-700 dark:text-brand-500 hover:underline"
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
    wrong: { label: 'Incorrecte', icon: AlertCircle, color: 'text-danger-700 dark:text-danger-500', bg: 'bg-danger-100 dark:bg-danger-950/30' },
    partial: { label: 'Partielle', icon: HelpCircle, color: 'text-warn-700 dark:text-warn-500', bg: 'bg-warn-100 dark:bg-warn-950/30' },
    unknown: { label: 'Indéterminée', icon: HelpCircle, color: 'text-muted-foreground', bg: 'bg-muted' },
    correct: { label: 'Correcte', icon: CheckCircle2, color: 'text-success-700 dark:text-success-500', bg: 'bg-success-100 dark:bg-success-950/30' }
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
          className="w-32 px-2 py-0.5 text-sm rounded border border-input bg-input-background outline-none focus:ring-2 focus:ring-ring text-foreground"
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
      className="text-muted-foreground hover:text-brand-700 dark:hover:text-brand-500 cursor-pointer flex items-center gap-1 group"
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
        <label className="text-xs font-[650] uppercase tracking-wider text-muted-foreground">{label}</label>
        <div className="flex gap-2">
          <input 
            autoFocus
            type="text" 
            value={val} 
            onChange={e => setVal(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm rounded border border-input bg-input-background outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(val); setIsEditing(false); }
              if (e.key === 'Escape') { setVal(title || ''); setIsEditing(false); }
            }}
          />
          <button onClick={() => { onSave(val); setIsEditing(false); }} className="p-1.5 bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-100 rounded hover:bg-brand-50">
            <Check size={16} />
          </button>
          <button onClick={() => { setVal(title || ''); setIsEditing(false); }} className="p-1.5 bg-muted text-muted-foreground rounded hover:bg-secondary">
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
          <label className="text-xs font-[650] uppercase tracking-wider text-muted-foreground">{label}</label>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-brand-700 dark:text-brand-500">{title}</h2>
            <Edit2 size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-700 dark:hover:text-brand-500 transition-colors py-2 border border-dashed border-border rounded-input px-4 bg-card/60 hover:bg-brand-50 dark:hover:bg-brand-950/30">
          <Edit2 size={14} />
          Ajouter un titre personnalisé
        </div>
      )}
    </div>
  )
}
