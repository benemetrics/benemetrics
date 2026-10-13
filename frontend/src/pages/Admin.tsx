import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Modal } from '../components/ui';
import { cn } from '../lib/utils';
import {
  createApp,
  createProject,
  deleteApp,
  deleteProject,
  getProject,
  listProjects,
  type AppDto,
  type ProjectDetailDto,
  type ProjectDto,
} from '../lib/api';

const PLATFORMS = [
  { value: 'node', label: 'Node.js / TS' },
  { value: 'javascript', label: 'Browser / JS' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'react-native', label: 'React Native' },
  { value: 'nextjs', label: 'Next.js' },
];

const PLATFORM_DOT: Record<string, string> = {
  node: 'bg-primary',
  javascript: 'bg-secondary',
  python: 'bg-tertiary',
  go: 'bg-error',
  ruby: 'bg-secondary',
  php: 'bg-primary',
  'react-native': 'bg-tertiary',
  nextjs: 'bg-secondary',
};

type Toast = { message: string; type: 'success' | 'warning' };

// Unwrap an Eden treaty response ({ data, error }) into the payload or null.
async function unwrap<T>(p: Promise<{ data: T | null; error: unknown } | null>): Promise<T | null> {
  try {
    const res = await p;
    if (!res || res.error) return null;
    return res.data;
  } catch {
    return null;
  }
}

function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2400);
  }, []);
  return { toast, showToast };
}

function AdminHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="fixed top-0 left-64 right-0 h-14 bg-surface/80 backdrop-blur-xl z-40 flex items-center justify-between px-margin-tablet shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-space-md">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-primary text-[20px]">admin_panel_settings</span>
          <span className="font-label-code-md text-label-code-md uppercase tracking-wider text-on-surface font-semibold">{title}</span>
        </div>
        {subtitle && (
          <>
            <span className="text-outline-variant font-label-code-sm text-label-code-sm">/</span>
            <span className="font-label-code-sm text-label-code-sm text-on-surface-variant bg-surface-container px-space-sm py-0.5 rounded-DEFAULT">{subtitle}</span>
          </>
        )}
      </div>
      {actions && <div className="flex items-center gap-space-sm">{actions}</div>}
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  'w-full h-10 px-3 bg-surface-container text-on-surface text-body-md rounded-lg focus:outline-none focus:bg-surface-container-high transition-colors placeholder:text-outline';

function ToastBubble({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[60] px-4 py-2.5 rounded-xl bg-surface-container-high shadow-lg flex items-center gap-2">
      <span className={cn('w-2 h-2 rounded-full', toast.type === 'success' ? 'bg-secondary' : 'bg-error')} />
      <span className="font-body-sm text-body-sm text-on-surface">{toast.message}</span>
    </div>
  );
}

// ============ Projects List (/admin) ============

export function AdminProjects() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    const res = await unwrap<{ data: ProjectDto[] }>(listProjects());
    setProjects(res?.data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const created = await unwrap<ProjectDto>(createProject({ name: name.trim(), slug: slug.trim() || undefined, description: description.trim() || undefined }));
    setBusy(false);
    if (!created) {
      showToast('Failed to create project', 'warning');
      return;
    }
    setCreateOpen(false);
    setName(''); setSlug(''); setDescription('');
    await load();
    showToast(`Project "${created.name}" created`);
  };

  const totalApps = projects.reduce((acc, p) => acc + (p.appCount ?? 0), 0);

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      <Sidebar />
      <div className="pl-64">
        <AdminHeader
          title="Admin Console"
          subtitle="Projects"
          actions={
            <button
              className="h-8 px-space-md bg-primary-container text-on-primary-container hover:brightness-110 rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)]"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Create Project</span>
            </button>
          }
        />

        <main className="w-full pt-14 bg-background min-h-screen px-margin-tablet">
          <div className="flex flex-col w-full pb-space-xl">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md py-space-md mb-space-sm">
              <div className="bg-surface-container-low rounded-xl p-space-md">
                <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Projects</span>
                <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight block mt-1">{projects.length}</span>
              </div>
              <div className="bg-surface-container-low rounded-xl p-space-md">
                <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Apps (DSNs)</span>
                <span className="font-headline-lg text-headline-lg text-primary tracking-tight block mt-1">{totalApps}</span>
              </div>
              <div className="bg-surface-container-low rounded-xl p-space-md">
                <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Ingest Endpoint</span>
                <span className="font-label-code-md text-label-code-md text-on-surface-variant font-mono block mt-2 truncate">/api/:ingestKey/envelope/</span>
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="border border-dashed border-outline-variant rounded-xl p-10 flex flex-col items-center justify-center gap-3 text-center">
                <span className="material-symbols-outlined text-[36px] text-outline">folder_open</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">No projects yet</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm">
                  Create your first project, then register apps inside it — every app gets its own DSN for ingestion.
                </p>
                <button
                  className="mt-2 h-9 px-space-md bg-primary-container text-on-primary-container hover:brightness-110 rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-all"
                  type="button"
                  onClick={() => setCreateOpen(true)}
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Create Project</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">
                {projects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/admin/projects/${p.id}`}
                    className="bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md transition-all group flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center">
                        <span className="material-symbols-outlined text-[18px]">folder</span>
                      </div>
                      <span className="material-symbols-outlined text-outline group-hover:text-primary text-[18px] transition-colors">arrow_forward</span>
                    </div>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold group-hover:text-primary transition-colors">{p.name}</h3>
                    <div className="flex items-center gap-space-sm flex-wrap font-label-code-sm text-label-code-sm">
                      <span className="text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded font-mono">{p.slug}</span>
                      <span className="text-outline">•</span>
                      <span className={cn('text-on-surface-variant flex items-center gap-1')}>
                        <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
                        {p.appCount} app{p.appCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    {p.description && <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">{p.description}</p>}
                    <span className="font-label-code-sm text-label-code-sm text-outline mt-auto">created {new Date(p.createdAt).toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Project">
        <Field label="Project Name">
          <input
            className={inputClass}
            type="text"
            placeholder="e.g. Checkout Platform"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Slug (optional — derived from name)">
          <input
            className={cn(inputClass, 'font-mono text-label-code-md')}
            type="text"
            placeholder="checkout-platform"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={cn(inputClass, 'h-20 py-2 resize-none')}
            placeholder="What lives inside this project?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <button
          className="w-full h-10 mt-2 rounded-lg bg-primary text-on-primary font-label-code-md text-label-code-md font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-40"
          type="button"
          disabled={!name.trim() || busy}
          onClick={handleCreate}
        >
          <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
          <span>{busy ? 'Creating…' : 'Create Project'}</span>
        </button>
      </Modal>

      <ToastBubble toast={toast} />
    </div>
  );
}

// ============ Project Detail (/admin/projects/:id) ============

function DsnField({ app }: { app: AppDto }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(app.dsn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex items-center w-full">
      <input
        readOnly
        value={app.dsn}
        className="w-full h-9 pl-3 pr-20 rounded-lg bg-surface-container-lowest text-on-surface text-label-code-md font-mono focus:outline-none select-all transition-all"
      />
      <button
        onClick={copy}
        className="absolute right-1 h-7 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-label-code-sm font-semibold flex items-center gap-1 transition-all"
      >
        <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [appName, setAppName] = useState('');
  const [platform, setPlatform] = useState('node');
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    if (!id) return;
    const res = await unwrap<ProjectDetailDto>(getProject(id));
    if (!res) {
      setNotFound(true);
      return;
    }
    setProject(res);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleCreateApp = async () => {
    if (!id || !appName.trim() || busy) return;
    setBusy(true);
    const created = await unwrap<AppDto>(createApp(id, { name: appName.trim(), platform }));
    setBusy(false);
    if (!created) {
      showToast('Failed to create app', 'warning');
      return;
    }
    setCreateOpen(false);
    setAppName('');
    await load();
    showToast(`App "${created.name}" created — DSN ready`);
  };

  const handleDeleteApp = async (app: AppDto) => {
    const ok = await unwrap<{ success: boolean }>(deleteApp(app.id));
    if (!ok) {
      showToast('Failed to delete app', 'warning');
      return;
    }
    await load();
    showToast(`App "${app.name}" deleted`, 'warning');
  };

  const handleDeleteProject = async () => {
    if (!id || !project) return;
    const ok = await unwrap<{ success: boolean }>(deleteProject(id));
    if (!ok) {
      showToast('Failed to delete project', 'warning');
      return;
    }
    navigate('/admin');
  };

  if (notFound) {
    return (
      <div className="bg-background font-body-md text-on-surface antialiased min-h-screen">
        <Sidebar />
        <div className="pl-64 pt-14 px-margin-tablet">
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <span className="material-symbols-outlined text-[36px] text-outline">search_off</span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Project not found</h3>
            <Link to="/admin" className="font-label-code-md text-label-code-md text-primary">← Back to Admin Console</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      <Sidebar />
      <div className="pl-64">
        <AdminHeader
          title="Admin Console"
          subtitle={project?.slug ?? 'project'}
          actions={
            <button
              className="h-8 px-space-md bg-primary-container text-on-primary-container hover:brightness-110 rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)]"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Create App</span>
            </button>
          }
        />

        <main className="w-full pt-14 bg-background min-h-screen px-margin-tablet">
          <div className="flex flex-col w-full pb-space-xl">
            <div className="flex items-center gap-space-sm py-space-md text-label-code-sm font-label-code-sm">
              <Link to="/admin" className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                Admin Console
              </Link>
              <span className="text-outline-variant">/</span>
              <span className="text-on-surface font-semibold">{project?.name ?? '…'}</span>
            </div>

            {project && (
              <>
                {/* Project Summary */}
                <div className="bg-surface-container-low rounded-xl p-space-md mb-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md">
                  <div className="flex items-start gap-space-md">
                    <div className="w-10 h-10 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[20px]">folder</span>
                    </div>
                    <div>
                      <h2 className="font-headline-md text-headline-md text-on-surface font-bold">{project.name}</h2>
                      <div className="flex items-center gap-space-sm flex-wrap mt-1 font-label-code-sm text-label-code-sm">
                        <span className="text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded font-mono">{project.slug}</span>
                        <span className="text-outline">•</span>
                        <span className="text-on-surface-variant">{project.appCount} app{project.appCount === 1 ? '' : 's'}</span>
                        <span className="text-outline">•</span>
                        <span className="text-outline">created {new Date(project.createdAt).toLocaleString()}</span>
                      </div>
                      {project.description && <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">{project.description}</p>}
                    </div>
                  </div>
                  <button
                    className="h-8 px-space-md self-start md:self-center bg-surface-container hover:bg-error-container hover:text-on-error-container text-on-surface-variant rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-colors"
                    type="button"
                    onClick={handleDeleteProject}
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    <span>Delete Project</span>
                  </button>
                </div>

                {/* Apps */}
                <div className="bg-surface-container-low px-space-md py-space-xs rounded-xl flex items-center justify-between text-outline font-label-code-sm text-label-code-sm tracking-wider uppercase mb-space-xs">
                  <span>Apps &amp; DSNs</span>
                  <span>{project.apps.length} registered</span>
                </div>

                {project.apps.length === 0 ? (
                  <div className="border border-dashed border-outline-variant rounded-xl p-10 flex flex-col items-center justify-center gap-3 text-center">
                    <span className="material-symbols-outlined text-[36px] text-outline">apps</span>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">No apps in this project</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm">
                      Register an app to generate its ingestion DSN. Point any Sentry SDK at the DSN and events land here.
                    </p>
                    <button
                      className="mt-2 h-9 px-space-md bg-primary-container text-on-primary-container hover:brightness-110 rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-all"
                      type="button"
                      onClick={() => setCreateOpen(true)}
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      <span>Create App</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {project.apps.map((app) => (
                      <div key={app.id} className="bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md transition-all flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-space-md">
                          <div className="flex items-center gap-space-md min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                              <span className="material-symbols-outlined text-[16px]">memory</span>
                            </div>
                            <div className="min-w-0">
                              <div className="font-body-md text-body-md text-on-surface font-semibold truncate">{app.name}</div>
                              <div className="flex items-center gap-space-sm flex-wrap font-label-code-sm text-label-code-sm text-on-surface-variant">
                                <span className={cn('w-1.5 h-1.5 rounded-full', PLATFORM_DOT[app.platform] ?? 'bg-outline')}></span>
                                {app.platform}
                                <span className="text-outline-variant">•</span>
                                <span className="font-mono text-outline">{app.ingestKey}</span>
                                <span className="text-outline-variant">•</span>
                                <span className="text-outline">created {new Date(app.createdAt).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          <button
                            className="w-7 h-7 rounded hover:bg-error-container hover:text-on-error-container text-outline flex items-center justify-center transition-colors shrink-0"
                            title="Delete app"
                            type="button"
                            onClick={() => handleDeleteApp(app)}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                        <DsnField app={app} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create App">
        <Field label="App Name">
          <input
            className={inputClass}
            type="text"
            placeholder="e.g. Billing Worker"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          />
        </Field>
        <Field label="Platform / SDK">
          <select
            className={inputClass}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <div className="bg-surface-container rounded-lg p-3 mb-3 flex items-start gap-2">
          <span className="material-symbols-outlined text-primary text-[16px] mt-0.5">key</span>
          <p className="font-label-code-sm text-label-code-sm text-on-surface-variant">
            A unique DSN (<code className="text-primary">https://&lt;publicKey&gt;@&lt;host&gt;/&lt;ingestKey&gt;</code>) is generated automatically for this app.
          </p>
        </div>
        <button
          className="w-full h-10 mt-2 rounded-lg bg-primary text-on-primary font-label-code-md text-label-code-md font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-40"
          type="button"
          disabled={!appName.trim() || busy}
          onClick={handleCreateApp}
        >
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          <span>{busy ? 'Creating…' : 'Create App & Generate DSN'}</span>
        </button>
      </Modal>

      <ToastBubble toast={toast} />
    </div>
  );
}
