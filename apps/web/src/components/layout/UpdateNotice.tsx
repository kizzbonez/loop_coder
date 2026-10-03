import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CLIENT_VERSION } from '../../lib/version';
import { Button } from '../ui/Button';

/** Polls the server version; after a deploy, offers to reload into the new web bundle. */
export function UpdateNotice() {
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const v = await api.get<{ version: string }>('/version');
        if (!cancelled) setServerVersion(v.version);
      } catch {
        /* offline or restarting; try again later */
      }
    };
    void check();
    const id = setInterval(check, 5 * 60_000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!serverVersion || serverVersion === CLIENT_VERSION) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-pop">
      <span className="text-[13px]">
        Version <b>{serverVersion}</b> is available (you are on {CLIENT_VERSION}).
      </span>
      <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
