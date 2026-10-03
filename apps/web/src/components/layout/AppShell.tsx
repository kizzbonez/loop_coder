import { Menu as MenuIcon } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { IconButton } from '../ui/Button';
import { PageLoader } from '../ui/misc';
import { Sidebar } from './Sidebar';
import { UpdateNotice } from './UpdateNotice';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative h-full w-72 border-r border-line bg-surface shadow-pop">
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 lg:hidden">
          <IconButton icon={MenuIcon} label="Open navigation" onClick={() => setMobileOpen(true)} />
          <span className="text-sm font-semibold">Loop Coder</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* Pages are code-split; keep the shell visible while one loads. */}
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <UpdateNotice />
    </div>
  );
}
