import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MobileNavBar } from '../components/MobileNavBar';
import { cn, relativeTime } from '../lib/utils';
import { getEvent } from '../lib/api';

interface Frame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  abs_path?: string;
}

interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: Frame[] };
}

interface Breadcrumb {
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  timestamp?: number | string;
}

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [inAppOnly, setInAppOnly] = useState(true);
  const [isResolved, setIsResolved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      try {
        const res = await getEvent(id);
        if (cancelled) return;
        if (res?.error || !res?.data) {
          setNotFound(true);
          return;
        }
        setEvent(res.data);
        setNotFound(false);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  const exception: ExceptionValue | undefined = event?.exception?.values?.[0];
  const frames: Frame[] = exception?.stacktrace?.frames ?? [];
  // Sentry frames are ordered outermost -> innermost; show innermost first
  const orderedFrames = [...frames].reverse();
  const visibleFrames = inAppOnly ? orderedFrames.filter((f) => f.in_app !== false) : orderedFrames;
  const hiddenCount = orderedFrames.length - visibleFrames.length;

  const breadcrumbs: Breadcrumb[] = event?.breadcrumbs?.values ?? [];

  const runtime = event?.contexts?.runtime;
  const os = event?.contexts?.os;

  const detailRows: Array<{ label: string; value: string }> = [];
  if (event?.event_id) detailRows.push({ label: 'Event ID', value: String(event.event_id) });
  if (event?.level) detailRows.push({ label: 'Level', value: String(event.level) });
  if (event?.environment) detailRows.push({ label: 'Environment', value: String(event.environment) });
  if (event?.release) detailRows.push({ label: 'Release', value: String(event.release) });
  if (event?.server_name) detailRows.push({ label: 'Server', value: String(event.server_name) });
  if (event?.platform) detailRows.push({ label: 'Platform', value: String(event.platform) });
  if (event?.sdk?.name) detailRows.push({ label: 'SDK', value: `${event.sdk.name}${event.sdk.version ? ` ${event.sdk.version}` : ''}` });

  if (notFound) {
    return (
      <div className="flex flex-col h-screen bg-surface pt-safe">
        <div className="px-4 pt-3 flex flex-col items-center justify-center gap-3 text-center flex-1">
          <span className="material-symbols-outlined text-[36px] text-outline">search_off</span>
          <h3 className="text-headline-sm text-on-surface font-semibold">Event not found</h3>
          <Link to="/issues" className="text-code-md text-primary">← Back to Issues</Link>
        </div>
        <MobileNavBar links={[
          { path: '/issues', label: 'Issues', icon: 'bug_report' },
          { path: '/performance', label: 'Perf', icon: 'speed' },
          { path: '/replays', label: 'Replays', icon: 'play_circle' },
          { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
        ]} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col h-screen bg-surface pt-safe">
        <div className="px-4 pt-6 flex justify-center">
          <span className="text-code-md text-on-surface-variant">Loading event…</span>
        </div>
        <MobileNavBar links={[
          { path: '/issues', label: 'Issues', icon: 'bug_report' },
          { path: '/performance', label: 'Perf', icon: 'speed' },
          { path: '/replays', label: 'Replays', icon: 'play_circle' },
          { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
        ]} />
      </div>
    );
  }

  const level = String(event.level ?? 'error');
  const levelClass = level === 'fatal' || level === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-primary';

  return (
    <div className="flex flex-col h-screen bg-surface pt-safe">
      <div className="px-4 pt-3 pb-2 overflow-y-auto flex-1">
        {/* Header — fields rendered only when present in the stored event */}
        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded uppercase tracking-wide font-bold text-code-sm', levelClass)}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
                {level}
              </span>
            </div>
            {event?.timestamp && (
              <div className="flex items-center gap-1.5 text-on-surface-variant text-code-sm">
                <span className="text-[14px] mds">history</span>
                {relativeTime(typeof event.timestamp === 'number' ? event.timestamp * 1000 : event.timestamp)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {exception?.type && <span className="text-error text-code-md tracking-tight">{exception.type}</span>}
            <h2 className="text-headline-md text-on-surface break-words leading-tight">
              {exception?.value ?? event?.message ?? 'Unknown Event'}
            </h2>
            {(() => {
              const crashFrame = frames[frames.length - 1];
              const culprit = crashFrame?.filename
                ? `${crashFrame.filename}:${crashFrame.lineno ?? '?'}`
                : (event?.culprit ?? null);
              return culprit ? (
                <span className="text-on-surface-variant text-code-sm truncate">{culprit}</span>
              ) : null;
            })()}
          </div>
          <div className="flex items-center justify-between pt-1 mt-1 bg-surface-container-lowest/60 -mx-3 -mb-3 px-3 py-1.5">
            <span className="text-code-sm text-outline font-mono truncate">{id}</span>
            {event?.timestamp && (
              <span className="text-code-sm text-on-surface-variant flex items-center gap-1">
                <span className="text-[14px] mds">schedule</span>
                {new Date(event.timestamp).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div className="overflow-x-auto no-scrollbar -mx-4 px-4 flex items-center gap-1 py-0.5">
          <button
            onClick={() => {
              setIsResolved(!isResolved);
              showToast(isResolved ? 'Issue reopened' : 'Issue marked as RESOLVED');
            }}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-code-sm active:scale-95 transition-all',
              isResolved
                ? 'bg-surface-container-high text-secondary'
                : 'bg-secondary text-on-secondary shadow-sm'
            )}
          >
            <span className="text-[16px] mds">check_circle</span>
            {isResolved ? 'Unresolve' : 'Resolve'}
          </button>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-code-sm active:scale-95 transition-all">
            <span className="text-[16px] mds text-on-surface-variant">snooze</span>
            Snooze
          </button>
        </div>

        {/* Event Details — only real fields from the payload */}
        {detailRows.length > 0 && (
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm mt-2">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-primary">info</span>
              <span className="text-headline-sm text-on-surface">Event Details</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {detailRows.map((rc) => (
                <div key={rc.label} className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                  <span className="text-code-sm text-on-surface-variant">{rc.label}</span>
                  <span className="text-code-sm text-on-surface bg-surface-container-high px-2 py-0.5 rounded font-mono truncate max-w-[70%]">{rc.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stack Trace — rendered from exception.stacktrace.frames */}
        {frames.length > 0 && (
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[18px] mds text-primary">terminal</span>
                <span className="text-headline-sm text-on-surface">Stack Trace</span>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={inAppOnly}
                  onChange={(e) => setInAppOnly(e.target.checked)}
                  className="sr-only"
                />
                <span className="w-8 h-4.5 bg-primary-container rounded-full flex items-center p-0.5 transition-colors">
                  <span className={cn('w-3.5 h-3.5 bg-surface rounded-full shadow-sm transition-transform', inAppOnly ? 'translate-x-3.5' : 'translate-x-0')} />
                </span>
                <span className="text-code-sm text-on-surface">In-App only</span>
              </label>
            </div>

            <div className="flex flex-col gap-1">
              {visibleFrames.map((frame, i) => {
                const isErrorFrame = i === 0 && frame.context_line;
                return (
                  <div key={i} className="bg-surface-container rounded-lg overflow-hidden flex flex-col">
                    <div className="bg-surface-container-high px-2 py-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn('text-[14px] mds flex-shrink-0', isErrorFrame ? 'text-error' : 'text-outline')}>crisis_alert</span>
                        <span className="text-code-md text-on-surface truncate">{frame.function ?? '(anonymous)'}</span>
                      </div>
                      <span className="text-code-sm text-primary flex-shrink-0">
                        {frame.filename ?? frame.abs_path ?? 'unknown'}{frame.lineno != null ? `:${frame.lineno}` : ''}
                      </span>
                    </div>
                    {(frame.pre_context?.length || frame.context_line || frame.post_context?.length) && (
                      <div className="bg-surface-container-lowest font-code-sm py-2 px-1 overflow-x-auto text-on-surface">
                        {(frame.pre_context ?? []).map((line, j) => (
                          <div key={`pre-${j}`} className="flex items-center px-2 py-0.5 opacity-60">
                            <code className="whitespace-pre">{line}</code>
                          </div>
                        ))}
                        {frame.context_line && (
                          <div className="flex items-center px-2 py-0.5 bg-error-container text-on-error-container font-semibold rounded -mx-1 pl-1">
                            <span className="text-[12px] mds text-error mr-2">arrow_right</span>
                            <code className="whitespace-pre">{frame.context_line}</code>
                          </div>
                        )}
                        {(frame.post_context ?? []).map((line, j) => (
                          <div key={`post-${j}`} className="flex items-center px-2 py-0.5 opacity-60">
                            <code className="whitespace-pre">{line}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {inAppOnly && hiddenCount > 0 && (
              <button
                onClick={() => setInAppOnly(false)}
                className="text-center text-code-sm text-primary py-1"
              >
                Showing {visibleFrames.length} In-App frames ({hiddenCount} runtime frames hidden)
              </button>
            )}
          </div>
        )}

        {/* Breadcrumbs — rendered from event.breadcrumbs.values */}
        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm mt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-secondary">timeline</span>
              <span className="text-headline-sm text-on-surface">Breadcrumbs</span>
            </div>
            <span className="text-code-sm text-on-surface-variant">{breadcrumbs.length} recorded</span>
          </div>
          {breadcrumbs.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No breadcrumbs recorded for this event.</p>
          ) : (
            <div className="flex flex-col relative pl-6 mt-1">
              <div className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5 bg-surface-container-highest" />
              {breadcrumbs.map((bc, i) => (
                <div key={i} className="relative flex flex-col pb-4 last:pb-0">
                  <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-surface-container-high flex items-center justify-center">
                    <span className="text-[12px] mds">{bc.level === 'error' ? 'error' : 'circle'}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-code-sm font-semibold text-on-surface">{bc.category ?? bc.type ?? 'breadcrumb'}</span>
                    {bc.timestamp && (
                      <span className="text-code-sm text-outline">
                        {new Date(typeof bc.timestamp === 'number' ? bc.timestamp * 1000 : bc.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {bc.message && (
                    <p className={cn('text-body-sm mt-0.5', bc.level === 'error' ? 'text-error' : 'text-on-surface')}>{bc.message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Runtime Context — only fields present in the payload */}
        {(runtime || os) && (
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm mt-2">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-primary">dns</span>
              <span className="text-headline-sm text-on-surface">Runtime Context</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {[
                runtime?.name && { label: 'Runtime', value: `${runtime.name}${runtime.version ? ` ${runtime.version}` : ''}` },
                os?.name && { label: 'Operating System', value: `${os.name}${os.version ? ` ${os.version}` : ''}` },
              ]
                .filter(Boolean)
                .map((rc) => (
                  <div key={rc!.label} className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                    <span className="text-code-sm text-on-surface-variant">{rc!.label}</span>
                    <span className="text-code-sm text-on-surface bg-surface-container-high px-2 py-0.5 rounded">{rc!.value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-xl bg-surface-container-high shadow-lg text-code-sm text-on-surface">
          {toast}
        </div>
      )}
      <MobileNavBar links={[
        { path: '/issues', label: 'Issues', icon: 'bug_report' },
        { path: '/performance', label: 'Perf', icon: 'speed' },
        { path: '/replays', label: 'Replays', icon: 'play_circle' },
        { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
      ]} />
    </div>
  );
}
