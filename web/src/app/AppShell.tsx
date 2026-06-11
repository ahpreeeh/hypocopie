import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import {
  NotebookPen, GraduationCap, Save, Check, Loader2, Menu, X,
  PanelLeftClose, PanelLeftOpen, AlertTriangle, FileWarning, Sun, Moon, Inbox,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './components/ui/sheet';
import { useTheme } from './theme-context';
import logoImg from '../imports/ChatGPT_Image_11_mai_2026__22_39_20.png';

const BACKUP_AUTO_KEY = 'hypocampus_last_backup_iso';
const BACKUP_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const APP_SIDEBAR_KEY = 'hypocampus_app_sidebar_expanded';

export function AppShell() {
  const { pathname } = useLocation();
  const [sidebarExpanded, setSidebarExpanded] = useState(() => localStorage.getItem(APP_SIDEBAR_KEY) !== '0');
  const [mobileOpen, setMobileOpen] = useState(false);

  const inTraining = pathname.startsWith('/entrainement');
  const inCaptures = pathname === '/' || pathname.startsWith('/captures');
  const inAdminVignettes = pathname.startsWith('/admin/vignettes');
  const inAdminCorrections = pathname.startsWith('/admin/corrections');

  // Badge "corrections en attente" : fetch initial + refresh quand on quitte
  // /admin/corrections (changement de path). Pas de polling pour ne pas
  // surcharger inutilement le serveur local.
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

  // Auto-backup 1x/jour au montage.
  useEffect(() => {
    const last = localStorage.getItem(BACKUP_AUTO_KEY);
    const lastMs = last ? Date.parse(last) : 0;
    const elapsed = Date.now() - lastMs;
    if (elapsed < BACKUP_AUTO_INTERVAL_MS) return;
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
      inCaptures={inCaptures}
      inTraining={inTraining}
      inAdminVignettes={inAdminVignettes}
      inAdminCorrections={inAdminCorrections}
      correctionsTotal={correctionsTotal}
      onToggle={() => setSidebarExpanded((value) => !value)}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="h-screen flex bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 md:hidden"
        title="Ouvrir la navigation"
      >
        <Menu size={18} />
      </button>

      <aside
        className={`hidden shrink-0 border-r border-neutral-200 bg-white transition-[width] duration-200 ease-out dark:border-neutral-800 dark:bg-neutral-900 md:flex ${
          sidebarExpanded ? 'w-56' : 'w-[76px]'
        }`}
      >
        {nav}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-xs gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <img src={logoImg} alt="Hypocampus" className="h-9 w-9 rounded-lg object-cover shadow-sm" />
                <div>
                  <div className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Hypocampus</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">Navigation</div>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarContent
              expanded={true}
              inCaptures={inCaptures}
              inTraining={inTraining}
              inAdminVignettes={inAdminVignettes}
              inAdminCorrections={inAdminCorrections}
              correctionsTotal={correctionsTotal}
              onToggle={() => setSidebarExpanded((value) => !value)}
              onNavigate={() => setMobileOpen(false)}
              hideToggle
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

function SidebarContent({
  expanded,
  inCaptures,
  inTraining,
  inAdminVignettes,
  inAdminCorrections,
  correctionsTotal,
  onToggle,
  onNavigate,
  hideToggle = false,
}: {
  expanded: boolean;
  inCaptures: boolean;
  inTraining: boolean;
  inAdminVignettes: boolean;
  inAdminCorrections: boolean;
  correctionsTotal: number | null;
  onToggle: () => void;
  onNavigate: () => void;
  hideToggle?: boolean;
}) {
  return (
    <nav className="flex h-full w-full flex-col gap-3 px-3 py-4">
      <div className={`flex items-center ${expanded ? 'justify-between gap-3' : 'justify-center'}`}>
        <Link to="/captures" onClick={onNavigate} className={`min-w-0 ${expanded ? 'flex items-center gap-3' : ''}`} title="Hypocampus">
          <img src={logoImg} alt="Hypocampus" className="h-11 w-11 rounded-xl object-cover shadow-sm" />
          {expanded && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">Hypocampus</div>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">Revisions</div>
            </div>
          )}
        </Link>
        {!hideToggle && expanded && (
          <button
            onClick={onToggle}
            className="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            title="Reduire la sidebar"
          >
            <PanelLeftClose size={17} />
          </button>
        )}
      </div>

      {!hideToggle && !expanded && (
        <button
          onClick={onToggle}
          className="mx-auto rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          title="Etendre la sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <div className="mt-2 space-y-1">
        <NavTile
          to="/captures"
          icon={<NotebookPen size={20} />}
          label="Cahier d'erreurs"
          active={inCaptures}
          expanded={expanded}
          onNavigate={onNavigate}
        />
        <NavTile
          to="/entrainement"
          icon={<GraduationCap size={20} />}
          label="Entrainement"
          active={inTraining}
          expanded={expanded}
          onNavigate={onNavigate}
        />
      </div>

      <div className="flex-1" />

      {expanded && (
        <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          Admin
        </div>
      )}
      <div className="space-y-1">
        <NavTile
          to="/admin/corrections"
          icon={<Inbox size={20} />}
          label="Corrections"
          active={inAdminCorrections}
          expanded={expanded}
          onNavigate={onNavigate}
          badge={correctionsTotal && correctionsTotal > 0 ? correctionsTotal : undefined}
        />
        <NavTile
          to="/admin/vignettes"
          icon={<FileWarning size={20} />}
          label="Vignettes orphelines"
          active={inAdminVignettes}
          expanded={expanded}
          onNavigate={onNavigate}
        />
        <BackupButton expanded={expanded} />
      </div>

      <ThemeToggle expanded={expanded} />
    </nav>
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
      className={`flex items-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${
        expanded ? 'w-full gap-3 px-3 py-2.5 text-sm' : 'mx-auto h-11 w-11 justify-center'
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
  let titleAttr = 'Creer une sauvegarde maintenant (auto 1x/jour)';
  let tone = 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100';
  if (busy) {
    icon = <Loader2 size={18} className="animate-spin" />;
    label = 'Sauvegarde';
    titleAttr = 'Sauvegarde en cours';
  } else if (success) {
    icon = <Check size={18} />;
    label = 'Sauvegardee';
    titleAttr = 'Sauvegarde creee';
    tone = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30';
  } else if (error) {
    label = 'Erreur';
    titleAttr = error;
    tone = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30';
  }

  return (
    <button
      onClick={handleBackup}
      disabled={busy}
      className={`flex items-center rounded-xl transition-colors disabled:opacity-60 ${
        expanded ? 'w-full gap-3 px-3 py-2.5 text-sm' : 'mx-auto h-11 w-11 justify-center'
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
  icon: React.ReactNode;
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
      className={`group relative flex items-center rounded-xl transition-colors ${
        expanded ? 'gap-3 px-3 py-2.5 text-sm' : 'mx-auto h-11 w-11 justify-center'
      } ${
        active
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
      }`}
      title={badgeLabel ? `${label} (${badgeLabel} en attente)` : label}
    >
      <span className="relative shrink-0">
        {icon}
        {badgeLabel && !expanded && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white shadow-sm">
            {badgeLabel}
          </span>
        )}
      </span>
      {expanded && <span className="truncate font-medium">{label}</span>}
      {expanded && badgeLabel && (
        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
          {badgeLabel}
        </span>
      )}
    </Link>
  );
}
