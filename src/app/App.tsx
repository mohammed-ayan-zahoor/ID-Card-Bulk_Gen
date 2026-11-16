import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignIn } from '@clerk/react';
import { importLegacyLayouts, migrateLegacyData, workspaceDb } from '../data/workspaceDb';
import { createCloudWorkspaceDb } from '../data/cloudWorkspaceDb';
import { emptyDocument, makeId } from '../data/types';
import type { CardDocument, LayoutRecord, Orientation, ProjectRecord } from '../data/types';
import type { WorkspaceAuth } from '../auth/types';

type Section = 'recent' | 'projects' | 'layouts';
type Route = { page: 'home'; section: Section } | { page: 'editor'; projectId: string };
type EditorBridge = Window & {
  loadProjectState?: (document: CardDocument) => void;
  getDocumentState?: (name?: string) => CardDocument;
  generateDocThumbnail?: () => Promise<string | null>;
  setSaveStatus?: (status: string) => void;
  setDocumentName?: (name: string) => void;
};

const routeFromLocation = (): Route => {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)$/);
  if (match) return { page: 'editor', projectId: decodeURIComponent(match[1]) };
  const section = new URLSearchParams(window.location.search).get('view');
  return { page: 'home', section: section === 'projects' || section === 'layouts' ? section : 'recent' };
};
const navigate = (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); };
const label = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const editedLabel = (value: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `Edited ${days} day${days === 1 ? '' : 's'} ago` : `Edited ${new Date(value).toLocaleDateString()}`;
};

export function App({ auth, accountName = null }: { auth?: WorkspaceAuth; accountName?: string | null }) {
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [layouts, setLayouts] = useState<LayoutRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [fileView, setFileView] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'edited' | 'name'>('edited');
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const cloudDb = useMemo(() => auth?.signedIn && auth.userId ? createCloudWorkspaceDb(auth.userId, auth.getToken) : null, [auth?.signedIn, auth?.userId, auth?.getToken]);
  const repository = cloudDb ?? workspaceDb;

  const refresh = useCallback(async () => {
    const [nextProjects, nextLayouts] = await Promise.all([repository.listProjects(), repository.listLayouts()]);
    setProjects(nextProjects); setLayouts(nextLayouts);
    setWorkspaceError(null);
  }, [repository]);

  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let active = true;
    if (auth?.clerkConfigured && !auth.loaded) return () => { active = false; };
    setLoaded(false);
    void migrateLegacyData().then(refresh).catch((error) => {
      console.error('Workspace loading failed:', error);
      if (active) setWorkspaceError(error instanceof Error ? error.message : 'Could not load this workspace.');
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [auth?.clerkConfigured, auth?.loaded, refresh]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
    if (event.key === 'idCardLayouts' && !cloudDb) void importLegacyLayouts().then(refresh).catch(console.error);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh, cloudDb]);

  useEffect(() => {
    if (route.page !== 'editor') { setProject(null); return; }
    let active = true;
    setProject(null);
    setWorkspaceError(null);
    void repository.listProjects().then((items) => {
      if (active) setProject(items.find((item) => item.id === route.projectId) || null);
    }).catch((error) => { if (active) setWorkspaceError(error instanceof Error ? error.message : 'Could not open this project.'); });
    return () => { active = false; };
  }, [route, repository]);

  const goHome = useCallback((section: Section = 'recent') => navigate(section === 'recent' ? '/' : `/?view=${section}`), []);
  const openProject = useCallback((item: ProjectRecord) => navigate(`/projects/${encodeURIComponent(item.id)}`), []);
  const saveProject = useCallback(async (item: ProjectRecord) => {
    await repository.saveProject(item);
    setProject(item);
    setProjects((current) => [item, ...current.filter((entry) => entry.id !== item.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [repository]);

  const createProject = useCallback(async (orientation: Orientation, layout?: LayoutRecord) => {
    const base = emptyDocument(orientation, layout?.name || 'Untitled card');
    const record: ProjectRecord = {
      ...base, kind: 'project', templateId: layout?.templateId || 'blank',
      backgrounds: layout?.backgrounds || {},
      placeholders: layout ? structuredClone(layout.placeholders) : { front: [], back: [] },
    };
    await repository.saveProject(record);
    setProjects((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    setShowCreate(false); openProject(record);
  }, [openProject, repository]);

  const renameProject = useCallback(async (item: ProjectRecord) => {
    const name = window.prompt('Name this project', item.name)?.trim();
    if (name && name !== item.name) await saveProject({ ...item, name, updatedAt: new Date().toISOString() });
  }, [saveProject]);

  const duplicateProject = useCallback(async (item: ProjectRecord) => {
    const now = new Date().toISOString();
    await saveProject({ ...structuredClone(item), id: makeId('project'), name: `${item.name} copy`, createdAt: now, updatedAt: now });
  }, [saveProject]);

  const deleteProject = useCallback(async (item: ProjectRecord) => {
    if (!window.confirm(`Move “${item.name}” to trash?`)) return;
    await repository.delete(item.id); setProjects((items) => items.filter((entry) => entry.id !== item.id));
  }, [repository]);

  const renameLayout = useCallback(async (item: LayoutRecord) => {
    const name = window.prompt('Name this layout', item.name)?.trim();
    if (name && name !== item.name) { await repository.saveLayout({ ...item, name, updatedAt: new Date().toISOString() }); await refresh(); }
  }, [refresh, repository]);
  const deleteLayout = useCallback(async (item: LayoutRecord) => {
    if (!window.confirm(`Delete the “${item.name}” layout?`)) return;
    if (!cloudDb) {
      for (const key of ['idCardLayouts', 'card_generator_layouts']) {
        try {
          const stored = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
          delete stored[item.name];
          localStorage.setItem(key, JSON.stringify(stored));
        } catch { /* IndexedDB remains the source for the workspace library. */ }
      }
    }
    await repository.delete(item.id); setLayouts((items) => items.filter((entry) => entry.id !== item.id));
  }, [cloudDb, repository]);

  const visibleProjects = useMemo(() => projects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)), [projects, query, sortBy]);
  const visibleLayouts = useMemo(() => layouts.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [layouts, query]);

  if (auth?.clerkConfigured && !auth.loaded) return <div className="loading-screen"><span className="spinner" />Checking your account…</div>;

  if (auth?.clerkConfigured && !auth.signedIn) return <main className="sign-in-screen"><div className="sign-in-heading"><Brand /><h1>Sign in to Quantech ID Studio</h1><p>Your projects and layouts are saved to your account.</p></div><SignIn routing="hash" /></main>;

  if (route.page === 'editor') {
    if (!project && loaded && workspaceError) return <main className="not-found"><Brand /><p>{workspaceError}</p><button className="button-secondary" onClick={() => void refresh()}>Try again</button><button className="button-secondary" onClick={() => goHome('projects')}>Back to projects</button></main>;
    if (!project && loaded) return <main className="not-found"><Brand /><p>This project could not be found in this workspace.</p><button className="button-secondary" onClick={() => goHome('projects')}>Back to projects</button></main>;
    return project ? <EditorScreen key={`${auth?.userId || 'local'}:${project.id}`} project={project} onBack={goHome} onSave={saveProject} /> : <div className="loading-screen"><span className="spinner" />Opening your project…</div>;
  }

  const section = route.section;
  return <div className="workspace-shell spectrum spectrum--dark">
    <header className="home-topbar"><Brand /><div className="workspace-account"><span className={`workspace-save-dot ${cloudDb ? 'cloud' : ''}`} /><span>{cloudDb ? `${accountName || 'Signed in'} · Cloud workspace` : auth?.signedIn ? `${accountName || 'Signed in'} · Local only` : 'Saved on this device'}</span>{auth?.accountControl}</div><button className="button-primary top-create" onClick={() => setShowCreate(true)}><Glyph name="plus" />Create new</button></header>
    <div className="home-body">
      <aside className="home-sidebar" aria-label="Workspace navigation"><div className="sidebar-caption">Workspace</div>
        {(['recent', 'projects', 'layouts'] as const).map((item) => <button key={item} className={`sidebar-link ${section === item ? 'active' : ''}`} onClick={() => goHome(item)}><Glyph name={item} />{label(item)}{item === 'projects' && <span className="sidebar-count">{projects.length}</span>}</button>)}
      </aside>
      <main className="home-content">
            <div className="content-heading"><h1>{section === 'recent' ? 'Recent' : section === 'projects' ? 'Projects' : 'Layouts'}</h1><div className="library-controls"><label className="search-field"><Glyph name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" aria-label="Search files" /></label><select aria-label="Sort files" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'edited' | 'name')}><option value="edited">Recently edited</option><option value="name">Name</option></select><div className="view-toggle" aria-label="File view"><button aria-label="Grid view" aria-pressed={fileView === 'grid'} onClick={() => setFileView('grid')}>Grid</button><button aria-label="List view" aria-pressed={fileView === 'list'} onClick={() => setFileView('list')}>List</button></div></div></div>
        {!loaded ? <div className="loading-inline"><span className="spinner" />Loading {cloudDb ? 'cloud' : 'local'} files…</div> : workspaceError ? <div className="workspace-error" role="alert"><strong>Could not load this workspace</strong><span>{workspaceError}</span><button className="button-secondary" onClick={() => void refresh()}>Try again</button></div> : <>
          {(section === 'recent' || section === 'projects') && <section className="home-section"><SectionHeading title={section === 'recent' ? 'Recent projects' : 'All projects'} detail={visibleProjects.length ? `${visibleProjects.length} ${visibleProjects.length === 1 ? 'project' : 'projects'}` : 'Projects you edit will appear here'} action={section === 'recent' && projects.length > 4 ? <button className="text-button" onClick={() => goHome('projects')}>View all →</button> : undefined} />
            {visibleProjects.length ? <div className={`file-grid recent-grid ${fileView === 'list' ? 'list-view' : ''}`}>{visibleProjects.slice(0, section === 'recent' ? 8 : undefined).map((item) => <ProjectCard key={item.id} project={item} onOpen={() => openProject(item)} onRename={() => void renameProject(item)} onDuplicate={() => void duplicateProject(item)} onDelete={() => void deleteProject(item)} />)}</div> : <EmptyState title={query ? 'No matching projects' : 'No projects yet'} text={query ? 'Try a different search.' : 'Create a card and it will be saved here automatically.'} action={!query ? <button className="button-secondary" onClick={() => setShowCreate(true)}>Create your first card</button> : undefined} />}
          </section>}
          {(section === 'recent' || section === 'layouts') && <section className="home-section"><SectionHeading title={section === 'recent' ? 'Your layouts' : 'Saved layouts'} detail={visibleLayouts.length ? `${visibleLayouts.length} reusable ${visibleLayouts.length === 1 ? 'layout' : 'layouts'}` : 'Save a design as a layout from the editor'} />
            {visibleLayouts.length ? <div className="file-grid">{visibleLayouts.map((item) => <div key={item.id} className="layout-card-wrap"><LayoutCard layout={item} onUse={() => void createProject(item.orientation, item)} /><div className="layout-card-actions"><button onClick={() => void renameLayout(item)}>Rename</button><button className="danger-action" onClick={() => void deleteLayout(item)}>Delete</button></div></div>)}</div> : <EmptyState title={query ? 'No matching layouts' : 'Your saved layouts will live here'} text={query ? 'Try a different search.' : 'Save a layout in the editor and it will appear here as a reusable preview.'} />}
          </section>}
        </>}
      </main>
    </div>
    {showCreate && <CreateDialog onClose={() => setShowCreate(false)} onCreate={(orientation) => void createProject(orientation)} />}
  </div>;
}

function Brand() { return <div className="brand-lockup"><span className="brand-name">Quantech ID Studio</span></div>; }

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<string, React.ReactNode> = {
    recent: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    projects: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></>,
    layouts: <><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    horizontal: <rect x="3" y="6" width="18" height="12" rx="2"/>,
    vertical: <rect x="7" y="3" width="10" height="18" rx="2"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  };
  return <svg {...common}>{paths[name] || paths.projects}</svg>;
}

function SectionHeading({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{detail}</p></div>{action}</div>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function CardPreview({ orientation, background, placeholders = [], variant = 'project' }: {
  orientation: Orientation;
  background?: string;
  placeholders?: CardDocument['placeholders']['front'];
  variant?: 'project' | 'layout';
}) {
  const ratio = orientation === 'horizontal' ? 'preview-wide' : 'preview-tall';
  const hasPreviewContent = placeholders.some((field) => field.type !== 'text' || Boolean(field.staticText && !/^\s*\{\{.*\}\}\s*$/.test(field.staticText)) || Boolean(field.key && !/^(new text|text|field)$/i.test(field.key)));
  const empty = !hasPreviewContent;
  const src = makeCardPreviewSvg(orientation, background, placeholders);
  return <div className={`card-preview ${ratio} ${variant}${empty ? ' is-empty' : ''}`} aria-label={`${label(orientation)} card preview`}>
    {empty ? <div className={`empty-card-art ${orientation === 'vertical' ? 'vertical' : ''}`}><span /></div> : <img className="preview-image" src={src} alt="" />}
    <span className="preview-orientation">{label(orientation)} · CR-80</span>
  </div>;
}

function makeCardPreviewSvg(orientation: Orientation, background: string | undefined, fields: CardDocument['placeholders']['front']) {
  const width = orientation === 'horizontal' ? 856 : 540;
  const height = orientation === 'horizontal' ? 540 : 856;
  const esc = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const nameField = fields.find((field) => field.type === 'text' && /name|person|employee/i.test(`${field.key || ''} ${field.staticText || ''}`));
  const nameBottom = nameField ? (nameField.y + nameField.height) * height : -1;
  const parts = fields.slice(0, 16).map((field) => {
    const x = Math.max(0, Math.min(width, field.x * width));
    const nominalY = field.y * height;
    const isDesignation = field.type === 'text' && /designation|title|role|position/i.test(`${field.key || ''} ${field.staticText || ''}`);
    const y = Math.max(0, Math.min(height, isDesignation && nameBottom >= nominalY ? nameBottom + height * .025 : nominalY));
    const w = Math.max(0, Math.min(width - x, field.width * width));
    const h = Math.max(0, Math.min(height - y, field.height * height));
    if (field.type === 'text') {
      const key = `${field.key || ''} ${field.staticText || ''}`.toLowerCase();
      const fallback = (field.staticText || '').replace(/\{\{.*?\}\}/g, '').trim() || (/^(new text|text|field)$/i.test(field.key || '') ? '' : (field.key || ''));
      const text = /name|person|employee/.test(key) ? 'Maya Chen' : /designation|title|role|position/.test(key) ? 'Product Designer' : /department|team/.test(key) ? 'Design' : /email/.test(key) ? 'maya@example.com' : /id|number/.test(key) ? 'ID 2048' : fallback;
      if (!text) return '';
      const size = Math.max(9, Math.min(42, Number(field.fontSize) || (/name/.test(key) ? 26 : 15)));
      return `<text x="${x}" y="${y + size}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${Number(field.fontWeight) >= 600 ? 600 : 400}" fill="${esc(String(field.color || '#252a31'))}">${esc(text)}</text>`;
    }
    if (field.type === 'photo') return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="#d9dee6" stroke="#aeb5c0" stroke-width="3"/><circle cx="${x+w/2}" cy="${y+h*.38}" r="${Math.min(w,h)*.16}" fill="#aab2bf"/><path d="M${x+w*.2} ${y+h*.86} Q${x+w/2} ${y+h*.48} ${x+w*.8} ${y+h*.86}" fill="#aab2bf"/>`;
    if (field.type === 'shape') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${esc(String(field.fill || '#dfe3e8'))}" stroke="${esc(String(field.stroke || '#aeb5c0'))}" stroke-width="2"/>`;
    if (field.type === 'qr') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#d0d4da"/><path d="M${x+w*.1} ${y+h*.1}h${w*.3}v${h*.3}h-${w*.3}z M${x+w*.6} ${y+h*.1}h${w*.3}v${h*.3}h-${w*.3}z M${x+w*.1} ${y+h*.6}h${w*.3}v${h*.3}h-${w*.3}z" fill="#222"/>`;
    return '';
  }).join('');
  const back = background ? `<image href="${esc(background)}" width="${width}" height="${height}" preserveAspectRatio="none"/>` : `<rect width="${width}" height="${height}" fill="#fff"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${back}${parts}<rect x="2" y="2" width="${width-4}" height="${height-4}" rx="24" fill="none" stroke="#d9d9d9" stroke-width="3"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ProjectCard({ project, onOpen, onRename, onDuplicate, onDelete }: { project: ProjectRecord; onOpen: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <article className="file-card"><button className="file-card-open" onClick={onOpen} aria-label={`Open ${project.name}`}>
    <span className="file-card__stage"><CardPreview orientation={project.orientation} background={project.backgrounds.front} placeholders={project.placeholders.front} /></span>
    <span className="file-card__footer"><span className="file-card__icon"><Glyph name={project.orientation} size={16} /></span><span className="file-card__copy"><span className="file-card-title">{project.name}</span><span className="file-card-edited">{editedLabel(project.updatedAt)}</span></span><span className="file-card-list-meta">{label(project.orientation)} · CR-80</span></span>
  </button><div className="file-card-menu-wrap"><button className="icon-button file-card-menu" aria-label={`More actions for ${project.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Glyph name="more" /></button>
    {menuOpen && <div className="context-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}>Rename</button><button role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}>Make a copy</button><button role="menuitem" className="danger-action" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete project</button></div>}
  </div></article>;
}

function LayoutCard({ layout, onUse }: { layout: LayoutRecord; onUse: () => void }) {
  return <button className="layout-card" onClick={onUse}><CardPreview orientation={layout.orientation} background={layout.backgrounds?.front} placeholders={layout.placeholders.front} variant="layout" /><span className="file-card-title">{layout.name}</span><span className="file-card-meta">Saved layout · {label(layout.orientation)}</span><span className="layout-use-label">Use layout <span aria-hidden="true">↗</span></span></button>;
}

function CreateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (orientation: Orientation) => void }) {
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
    <div className="dialog-heading"><div><p className="eyebrow">NEW PROJECT</p><h2 id="create-dialog-title">Create a blank card</h2><p className="muted-copy">Choose a card direction and start with a clean canvas.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><Glyph name="close" /></button></div>
    <div className="choice-row" role="group" aria-label="Card orientation">{(['horizontal', 'vertical'] as const).map((item) => <button key={item} className={`orientation-choice ${orientation === item ? 'selected' : ''}`} onClick={() => setOrientation(item)} aria-pressed={orientation === item}><Glyph name={item} size={20} />{label(item)}</button>)}</div>
    <div className="dialog-footer"><span className="muted-copy">85.6 × 54 mm · CR-80</span><button className="button-primary" onClick={() => onCreate(orientation)}>Create blank card <span aria-hidden="true">→</span></button></div>
  </section></div>;
}

function EditorScreen({ project, onBack, onSave }: { project: ProjectRecord; onBack: (section?: Section) => void; onSave: (project: ProjectRecord) => Promise<void> }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const projectRef = useRef(project);
  const signatureRef = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const [, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  useEffect(() => { projectRef.current = project; }, [project]);

  const capture = useCallback(async (force = false) => {
    const legacy = frameRef.current?.contentWindow as EditorBridge | null | undefined;
    const getDocumentState = legacy?.getDocumentState;
    if (!legacy || !getDocumentState) return;
    if (inFlight.current) {
      await inFlight.current;
      if (force) return capture(true);
      return;
    }
    const task = (async () => {
      try {
        const doc = getDocumentState(projectRef.current.name);
        const signature = JSON.stringify({ orientation: doc.orientation, backgrounds: doc.backgrounds, placeholders: doc.placeholders, templateId: doc.templateId });
        if (!force && signature === signatureRef.current) return;
        signatureRef.current = signature; setStatus('saving'); legacy.setSaveStatus?.('Saving');
        const thumbnail = await legacy.generateDocThumbnail?.() ?? projectRef.current.thumbnail;
        const updated: ProjectRecord = { ...projectRef.current, ...doc, kind: 'project', id: projectRef.current.id, name: projectRef.current.name, schemaVersion: 1, createdAt: projectRef.current.createdAt, updatedAt: new Date().toISOString(), thumbnail };
        await onSave(updated); projectRef.current = updated; setStatus('saved'); legacy.setSaveStatus?.('Saved');
      } catch (error) { signatureRef.current = ''; console.error('Project autosave failed:', error); setStatus('error'); (frameRef.current?.contentWindow as EditorBridge | null)?.setSaveStatus?.('Save failed'); }
    })();
    inFlight.current = task;
    try { await task; } finally { if (inFlight.current === task) inFlight.current = null; }
  }, [onSave]);

  const onFrameLoad = useCallback(() => {
    const legacy = frameRef.current?.contentWindow as EditorBridge | null | undefined;
    if (!legacy?.loadProjectState) return;
    legacy.loadProjectState(projectRef.current);
    legacy.setDocumentName?.(projectRef.current.name);
    legacy.setSaveStatus?.('Saved');
    window.setTimeout(() => { void capture(true); }, 350);
  }, [capture]);

  useEffect(() => {
    const timer = window.setInterval(() => { void capture(); }, 900);
    const saveOnHide = () => { if (document.visibilityState === 'hidden') void capture(true); };
    document.addEventListener('visibilitychange', saveOnHide);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', saveOnHide); };
  }, [capture]);

  return <div className="editor-host-shell"><header className="editor-host-bar"><button className="back-home-button" onClick={() => { void capture(true).finally(() => onBack('recent')); }}><Glyph name="back" size={17} /><span>Workspace</span></button></header><iframe ref={frameRef} className="editor-frame" src="/editor.html" title="ID card editor" onLoad={onFrameLoad}/></div>;
}
