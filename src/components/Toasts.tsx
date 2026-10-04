import { useSession } from '../store/sessionStore';
import { useT } from '../hooks/useT';

export function Toasts() {
  const t = useT();
  const toasts = useSession((s) => s.toasts);
  const dismiss = useSession((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => dismiss(toast.id)}>
          {t(toast.key, toast.vars)}
        </div>
      ))}
    </div>
  );
}
