import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import {
  AlertTriangle,
  BookOpen,
  Check,
  FileWarning,
  History,
  Inbox,
  LayoutDashboard,
  Loader2,
  Menu,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  ScanText,
  Sun,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './components/ui/sheet';
import { useTheme } from './theme-context';
import logoImg from '../imports/ChatGPT_Image_11_mai_2026__22_39_20.png';

const BACKUP_AUTO_KEY = 'hypocampus_last_backup_iso';
const BACKUP_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_SIDEBAR_KEY = 'hypocampus_app_sidebar_expanded';

export function AppShell() {
  const { pathname } = useLocation();
  const [sidebarExpanded, setSidebarExpanded] = useState(() => localStorage.getItem(APP_SIDEBAR_KEY) !== '0');
  const [mobileOpen, setMobileOpen] = useState(false);

  const inDashboard = pathname === '/' || pathname === '/entrainement';
  const inImport = pathname.startsWith('/entrainement/import');
  const inHistory = pathname.startsWith('/entrainement/historique');
  const inExam = pathname.startsWith('/entrainement/') && !inImport && !inHistory;
  const inCaptures = pathname.startsWith('/captures');
  const inAdminVignettes = pathname.startsWith('/admin/vignettes');
  const inAdminCorrections = pathname.startsWith('/admin/corrections');

  const [correctionsTotal, setCorrectionsTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/reports/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCorrectionsTotal(typeof data.total === 'number' ? data.total : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    localStorage.setItem(APP_SIDEBAR_KEY, sidebarExpanded ? '1' : '0');
  }, [sidebarExpanded]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const last = localStorage.getItem(BACKUP_AUTO_KEY);
    const lastMs = last ? Date.parse(last) : 0;
    if (Date.now() - lastMs < BACKUP_AUTO_INTERVAL_MS) return;
    fetch('/api/admin/backup', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.filename) {
          localStorage.setItem(BACKUP_AUTO_KEY, new Date().toISOString());
          console.log(`[backup] auto-backup cree : ${data.filename} (${Math.round(data.sizeBytes / 1024 / 1024)} MB)`);
        }
      })
      .catch(() => {});
  }, []);

  const nav = (
    <SidebarContent
      expanded={sidebarExpanded}
      active={{
        dashboard: inDashboard,
        import: inImport,
        history: inHistory,
        exam: inExam,
        captures: inCaptures,
        corrections: inAdminCorrections,
        vignettes: inAdminVignettes,
      }}
      correctionsTotal={correctionsTotal}
      onToggle={() => setSidebarExpanded((value) => !value)}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-input border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground md:hidden"
        title="Ouvrir la navigation"
      >
        <Menu size={18} />
      </button>

      <aside
        className={`hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex ${
          sidebarExpanded ? 'w-[230px]' : 'w-[76px]'
        }`}
      >
        {nav}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-xs gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
              <Brand expanded />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-input p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarContent
              expanded
              active={{
                dashboard: inDashboard,
                import: inImport,
                history: inHistory,
                exam: inExam,
                captures: inCaptures,
                corrections: inAdminCorrections,
                vignettes: inAdminVignettes,
              }}
              correctionsTotal={correctionsTotal}
              onToggle={() => setSidebarExpanded((value) => !value)}
              onNavigate={() => setMobileOpen(false)}
              hideToggle
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

function SidebarContent({
  expanded,
  active,
  correctionsTotal,
  onToggle,
  onNavigate,
  hideToggle = false,
}: {
  expanded: boolean;
  active: {
    dashboard: boolean;
    import: boolean;
    history: boolean;
    exam: boolean;
    captures: boolean;
    corrections: boolean;
    vignettes: boolean;
  };
  correctionsTotal: number | null;
  onToggle: () => void;
  onNavigate: () => void;
  hideToggle?: boolean;
}) {
  return (
    <nav className="flex h-full w-full flex-col px-3 py-4">
      <div className={`flex items-center ${expanded ? 'justify-between gap-3' : 'justify-center'}`}>
        <Brand expanded={expanded} onNavigate={onNavigate} />
        {!hideToggle && expanded && (
          <button
            onClick={onToggle}
            className="rounded-input p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Reduire la sidebar"
          >
            <PanelLeftClose size={17} />
          </button>
        )}
      </div>

      {!hideToggle && !expanded && (
        <button
          onClick={onToggle}
          className="mx-auto mt-3 rounded-input p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title="Etendre la sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <SidebarSection label="Reviser" expanded={expanded}>
        <NavTile to="/entrainement" icon={<LayoutDashboard size={19} />} label="Tableau de bord" active={active.dashboard} expanded={expanded} onNavigate={onNavigate} />
        <NavTile to="/captures" icon={<NotebookPen size={19} />} label="Cahier d'erreurs" active={active.captures} expanded={expanded} onNavigate={onNavigate} />
        <NavTile to="/entrainement/historique" icon={<History size={19} />} label="Historique" active={active.history} expanded={expanded} onNavigate={onNavigate} />
        {active.exam && (
          <NavTile to="/entrainement" icon={<BookOpen size={19} />} label="Annale en cours" active expanded={expanded} onNavigate={onNavigate} />
        )}
      </SidebarSection>

      <SidebarSection label="Maintenance" expanded={expanded} className="mt-4">
        <NavTile to="/entrainement/import" icon={<ScanText size={19} />} label="Importer" active={active.import} expanded={expanded} onNavigate={onNavigate} />
        <NavTile
          to="/admin/corrections"
          icon={<Inbox size={19} />}
          label="Corrections"
          active={active.corrections}
          expanded={expanded}
          onNavigate={onNavigate}
          badge={correctionsTotal && correctionsTotal > 0 ? correctionsTotal : undefined}
        />
        <NavTile to="/admin/vignettes" icon={<FileWarning size={19} />} label="Vignettes" active={active.vignettes} expanded={expanded} onNavigate={onNavigate} />
        <BackupButton expanded={expanded} />
      </SidebarSection>

      <div className="flex-1" />
      <ThemeToggle expanded={expanded} />
    </nav>
  );
}

function Brand({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  return (
    <Link to="/entrainement" onClick={onNavigate} className={`min-w-0 ${expanded ? 'flex items-center gap-3' : ''}`} title="Hypocampus">
      <img src={logoImg} alt="Hypocampus" className="h-10 w-10 rounded-[10px] object-cover shadow-sm" />
      {expanded && (
        <div className="min-w-0">
          <div className="truncate text-sm font-[650] tracking-[-0.01em] text-sidebar-foreground">Hypocampus</div>
          <div className="truncate text-[11px] text-muted-foreground">Revisions</div>
        </div>
      )}
    </Link>
  );
}

function SidebarSection({
  label,
  expanded,
  children,
  className = '',
}: {
  label: string;
  expanded: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      {expanded && (
        <div className="px-3 pb-1 pt-5 text-[10.5px] font-[650] uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function ThemeToggle({ expanded }: { expanded: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const icon = isDark ? <Sun size={18} /> : <Moon size={18} />;
  const label = isDark ? 'Mode clair' : 'Mode sombre';
  return (
    <button
      onClick={toggleTheme}
      className={`flex items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
        expanded ? 'w-full gap-3 px-3 py-2 text-[13.5px]' : 'mx-auto h-11 w-11 justify-center'
      }`}
      title={label}
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="truncate font-medium">{label}</span>}
    </button>
  );
}

function BackupButton({ expanded }: { expanded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBackup = async () => {
    setBusy(true);
    setSuccess(false);
    setError(null);
    try {
      const response = await fetch('/api/admin/backup', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      localStorage.setItem(BACKUP_AUTO_KEY, new Date().toISOString());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || String(e));
      setTimeout(() => setError(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  let icon = <Save size={18} />;
  let label = 'Sauvegarder';
  let titleAttr = 'Creer une sauvegarde maintenant';
  let tone = 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
  if (busy) {
    icon = <Loader2 size={18} className="animate-spin" />;
    label = 'Sauvegarde';
    titleAttr = 'Sauvegarde en cours';
  } else if (success) {
    icon = <Check size={18} />;
    label = 'Sauvegardee';
    titleAttr = 'Sauvegarde creee';
    tone = 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-100';
  } else if (error) {
    icon = <AlertTriangle size={18} />;
    label = 'Erreur';
    titleAttr = error;
    tone = 'bg-danger-50 text-danger-700 dark:bg-danger-950/40 dark:text-danger-100';
  }

  return (
    <button
      onClick={handleBackup}
      disabled={busy}
      className={`flex items-center rounded-[10px] transition-colors disabled:opacity-60 ${
        expanded ? 'w-full gap-3 px-3 py-2 text-[13.5px]' : 'mx-auto h-11 w-11 justify-center'
      } ${tone}`}
      title={titleAttr}
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="truncate font-medium">{label}</span>}
    </button>
  );
}

function NavTile({
  to,
  icon,
  label,
  active,
  expanded,
  onNavigate,
  badge,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onNavigate: () => void;
  badge?: number;
}) {
  const badgeLabel = typeof badge === 'number' && badge > 0
    ? (badge > 99 ? '99+' : String(badge))
    : null;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`group relative flex items-center rounded-[10px] transition-colors ${
        expanded ? 'gap-3 px-3 py-2 text-[13.5px]' : 'mx-auto h-11 w-11 justify-center'
      } ${
        active
          ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-100 dark:ring-brand-700/40'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      }`}
      title={badgeLabel ? `${label} (${badgeLabel} en attente)` : label}
    >
      <span className="relative shrink-0">
        {icon}
        {badgeLabel && !expanded && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warn-500 px-1 text-[9px] font-[650] text-white shadow-sm">
            {badgeLabel}
          </span>
        )}
      </span>
      {expanded && <span className="truncate font-medium">{label}</span>}
      {expanded && badgeLabel && (
        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-pill bg-warn-500 px-1.5 text-[10px] font-[650] text-white">
          {badgeLabel}
        </span>
      )}
    </Link>
  );
}
