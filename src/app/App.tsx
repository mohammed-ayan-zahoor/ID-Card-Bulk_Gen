import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignIn } from '@clerk/react';
import { importLegacyLayouts, migrateLegacyData, workspaceDb } from '../data/workspaceDb';
import { createCloudWorkspaceDb } from '../data/cloudWorkspaceDb';
import { emptyDocument, makeId } from '../data/types';
import type { CardDocument, LayoutRecord, LayoutSummary, Orientation, ProjectRecord, ProjectSummary, WorkspacePageCursor } from '../data/types';
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const [hasMoreProjects, setHasMoreProjects] = useState(false);
  const [projectCursor, setProjectCursor] = useState<WorkspacePageCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [unsavedWarning, setUnsavedWarning] = useState<string | null>(() => {
    try { return sessionStorage.getItem('quantech:unsaved_warning'); } catch { return null; }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const [showCreate, setShowCreate] = useState(false);
  const [importingLayouts, setImportingLayouts] = useState(false);
  const layoutImportRef = useRef<HTMLInputElement>(null);
  const [fileView, setFileView] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'edited' | 'name'>('edited');
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const cloudDb = useMemo(() => auth?.signedIn && auth.userId ? createCloudWorkspaceDb(auth.userId, auth.getToken) : null, [auth?.signedIn, auth?.userId, auth?.getToken]);
  const repository = cloudDb ?? workspaceDb;

  const refresh = useCallback(async () => {
    const t0 = performance.now();
    const [projectPage, layoutPage] = await Promise.all([
      repository.listProjectsPage(null, query, sortBy),
      repository.listLayoutsPage(null, query),
    ]);
    console.info(`[Perf] Workspace loaded in ${(performance.now() - t0).toFixed(0)}ms (${projectPage.items.length} projects, ${layoutPage.items.length} layouts)`);
    setProjects(projectPage.items);
    setHasMoreProjects(projectPage.hasMore);
    setProjectCursor(projectPage.nextCursor);
    setLayouts(layoutPage.items);
    setWorkspaceError(null);
  }, [repository, query, sortBy]);

  const loadMoreProjects = useCallback(async () => {
    if (!projectCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = await repository.listProjectsPage(projectCursor, query, sortBy);
      setProjects((current) => [...current, ...nextPage.items]);
      setHasMoreProjects(nextPage.hasMore);
      setProjectCursor(nextPage.nextCursor);
    } catch (err) {
      console.error('Failed to load more projects:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [projectCursor, loadingMore, repository, query, sortBy]);

  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let active = true;
    if (auth?.clerkConfigured && !auth.loaded) return () => { active = false; };
    setLoaded(false);
    const loadWorkspace = cloudDb
      ? Promise.all([migrateLegacyData(), refresh()]).then(() => undefined)
      : migrateLegacyData().then(refresh).then(() => undefined);
    void loadWorkspace.catch((error) => {
      console.error('Workspace loading failed:', error);
      if (active) setWorkspaceError(error instanceof Error ? error.message : 'Could not load this workspace.');
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [auth?.clerkConfigured, auth?.loaded, cloudDb, refresh]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'idCardLayouts' && !cloudDb) void importLegacyLayouts().then(refresh).catch(console.error);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh, cloudDb]);

  useEffect(() => {
    if (auth?.loaded) {
      console.info(`[Perf] Auth ready (${auth.clerkConfigured ? 'Clerk' : 'Local'}, account: ${accountName || 'guest'})`);
    }
  }, [auth?.loaded, auth?.clerkConfigured, accountName]);

  useEffect(() => {
    if (route.page !== 'editor') { setProject(null); return; }
    let active = true;
    setProject(null);
    setWorkspaceError(null);
    const t0 = performance.now();
    void repository.getProject(route.projectId).then((item) => {
      if (active) {
        if (item) console.info(`[Perf] Project document '${item.name}' loaded in ${(performance.now() - t0).toFixed(0)}ms`);
        setProject(item || null);
      }
    }).catch((error) => { if (active) setWorkspaceError(error instanceof Error ? error.message : 'Could not open this project.'); });
    return () => { active = false; };
  }, [route, repository]);

  const goHome = useCallback((section: Section = 'recent') => navigate(section === 'recent' ? '/' : `/?view=${section}`), []);
  const openProject = useCallback((item: ProjectSummary | ProjectRecord) => navigate(`/projects/${encodeURIComponent(item.id)}`), []);
  const saveProject = useCallback(async (item: ProjectRecord) => {
    await repository.saveProject(item);
    setProject(item);
    const summary: ProjectSummary = {
      kind: 'project', id: item.id, name: item.name, orientation: item.orientation,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
      frontBackground: item.backgrounds.front, previewFields: (item.placeholders.front || []).slice(0, 24),
    };
    setProjects((current) => [summary, ...current.filter((entry) => entry.id !== item.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [repository]);

  const createProject = useCallback(async (orientation: Orientation, layout?: LayoutRecord | LayoutSummary) => {
    let fullLayout: LayoutRecord | undefined;
    if (layout) {
      if ('backgrounds' in layout && layout.backgrounds) fullLayout = layout as LayoutRecord;
      else fullLayout = await repository.getLayout(layout.id);
    }
    const base = emptyDocument(orientation, fullLayout?.name || 'Untitled card');
    const record: ProjectRecord = {
      ...base, kind: 'project', templateId: fullLayout?.templateId || 'blank',
      backgrounds: fullLayout?.backgrounds || {},
      backgroundAssetKeys: fullLayout?.backgroundAssetKeys,
      placeholders: fullLayout ? structuredClone(fullLayout.placeholders) : { front: [], back: [] },
    };
    await repository.saveProject(record);
    const summary: ProjectSummary = {
      kind: 'project', id: record.id, name: record.name, orientation: record.orientation,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
      frontBackground: record.backgrounds.front, previewFields: (record.placeholders.front || []).slice(0, 24),
    };
    setProjects((current) => [summary, ...current.filter((item) => item.id !== record.id)]);
    setShowCreate(false); openProject(record);
  }, [openProject, repository]);

  const renameProject = useCallback(async (item: ProjectSummary) => {
    const name = window.prompt('Name this project', item.name)?.trim();
    if (!name || name === item.name) return;
    const full = await repository.getProject(item.id);
    if (full) await saveProject({ ...full, name, updatedAt: new Date().toISOString() });
  }, [saveProject, repository]);

  const duplicateProject = useCallback(async (item: ProjectSummary) => {
    const full = await repository.getProject(item.id);
    if (!full) return;
    const now = new Date().toISOString();
    await saveProject({ ...structuredClone(full), id: makeId('project'), name: `${full.name} copy`, createdAt: now, updatedAt: now });
  }, [saveProject, repository]);

  const deleteProject = useCallback(async (item: ProjectSummary) => {
    if (!window.confirm(`Move “${item.name}” to trash?`)) return;
    await repository.delete(item.id); setProjects((items) => items.filter((entry) => entry.id !== item.id));
  }, [repository]);

  const renameLayout = useCallback(async (item: LayoutSummary) => {
    const name = window.prompt('Name this layout', item.name)?.trim();
    if (!name || name === item.name) return;
    const full = await repository.getLayout(item.id);
    if (full) { await repository.saveLayout({ ...full, name, updatedAt: new Date().toISOString() }); await refresh(); }
  }, [refresh, repository]);
  const deleteLayout = useCallback(async (item: LayoutSummary) => {
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

  const saveLayout = useCallback(async (item: LayoutRecord) => {
    await repository.saveLayout(item);
    const summary: LayoutSummary = {
      kind: 'layout',
      id: item.id,
      name: item.name,
      orientation: item.orientation,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      frontBackground: item.backgrounds?.front,
      previewFields: (item.placeholders.front || []).slice(0, 24),
    };
    setLayouts((current) => [summary, ...current.filter((entry) => entry.id !== item.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [repository]);

  const importLayoutFile = useCallback(async (file: File) => {
    setImportingLayouts(true);
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      let source: Record<string, unknown>;
      if (parsed.layouts && typeof parsed.layouts === 'object') source = parsed.layouts as Record<string, unknown>;
      else if (parsed.placeholders) {
        const name = typeof parsed.name === 'string' ? parsed.name : file.name.replace(/\.json$/i, '');
        source = { [name]: parsed };
      } else source = parsed;

      const now = new Date().toISOString();
      const records = Object.entries(source).flatMap(([name, raw]) => {
        if (!raw || typeof raw !== 'object') return [];
        const value = raw as Partial<LayoutRecord> & { dateCreated?: string };
        if ((value.orientation !== 'horizontal' && value.orientation !== 'vertical') || !value.placeholders) return [];
        const createdAt = value.createdAt || value.dateCreated || value.updatedAt || now;
        return [{
          ...value,
          id: makeId('layout'),
          kind: 'layout' as const,
          schemaVersion: 1 as const,
          name: value.name || name,
          orientation: value.orientation,
          backgrounds: value.backgrounds || {},
          placeholders: { front: value.placeholders.front || [], back: value.placeholders.back || [] },
          createdAt,
          updatedAt: value.updatedAt || createdAt,
        }];
      });
      if (records.length === 0) throw new Error('No valid layouts were found in that JSON file.');
      for (const record of records) await repository.saveLayout(record);
      const summaries: LayoutSummary[] = records.map((record) => ({
        kind: 'layout',
        id: record.id,
        name: record.name,
        orientation: record.orientation,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        frontBackground: record.backgrounds?.front,
        previewFields: (record.placeholders.front || []).slice(0, 24),
      }));
      setLayouts((current) => [...summaries, ...current].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      window.alert(`Imported ${records.length} layout${records.length === 1 ? '' : 's'}. The original file and browser layouts were left unchanged.`);
    } catch (error) {
      window.alert(error instanceof Error ? `Could not import layouts: ${error.message}` : 'Could not import layouts from this file.');
    } finally {
      setImportingLayouts(false);
      if (layoutImportRef.current) layoutImportRef.current.value = '';
    }
  }, [repository]);

  const visibleProjects = useMemo(() => projects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)), [projects, query, sortBy]);
  const visibleLayouts = useMemo(() => layouts.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [layouts, query]);

  if (auth?.clerkConfigured && !auth.loaded) return <div className="loading-screen"><span className="spinner" />Checking your account…</div>;

  if (auth?.clerkConfigured && !auth.signedIn) return <main className="sign-in-screen"><div className="sign-in-heading"><Brand /><h1>Sign in to Quantech ID Studio</h1><p>Your projects and layouts are saved to your account.</p></div><SignIn routing="hash" /></main>;

  if (route.page === 'editor') {
    if (!project && loaded && workspaceError) return <main className="not-found"><Brand /><p>{workspaceError}</p><button className="button-secondary" onClick={() => void refresh()}>Try again</button><button className="button-secondary" onClick={() => goHome('projects')}>Back to projects</button></main>;
    if (!project && loaded) return <main className="not-found"><Brand /><p>This project could not be found in this workspace.</p><button className="button-secondary" onClick={() => goHome('projects')}>Back to projects</button></main>;
    return project ? <EditorScreen key={`${auth?.userId || 'local'}:${project.id}`} project={project} onBack={goHome} onSave={saveProject} onSaveLayout={saveLayout} /> : <div className="loading-screen"><span className="spinner" />Opening your project…</div>;
  }

  const section = route.section;
  return <div className="workspace-shell spectrum spectrum--dark">
    <header className="home-topbar"><Brand /><div className="workspace-account"><span className={`workspace-save-dot ${cloudDb ? 'cloud' : ''}`} /><span>{cloudDb ? `${accountName || 'Signed in'} · Cloud workspace` : auth?.signedIn ? `${accountName || 'Signed in'} · Local only` : 'Saved on this device'}</span>{auth?.accountControl}</div><button className="button-primary top-create" onClick={() => setShowCreate(true)}><Glyph name="plus" />Create new</button></header>
    <div className="home-body">
      <aside className="home-sidebar" aria-label="Workspace navigation"><div className="sidebar-caption">Workspace</div>
        {(['recent', 'projects', 'layouts'] as const).map((item) => <button key={item} className={`sidebar-link ${section === item ? 'active' : ''}`} onClick={() => goHome(item)}><Glyph name={item} />{label(item)}{item === 'projects' && <span className="sidebar-count">{projects.length}</span>}</button>)}
      </aside>
      <main className="home-content">
        {unsavedWarning && (
          <div className="workspace-warning-banner" role="alert" style={{ background: '#3d2800', border: '1px solid #734e00', color: '#ffc86b', padding: '10px 16px', borderRadius: '6px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>⚠️ Changes to <strong>{unsavedWarning}</strong> may not have finished saving before returning. Open the project to review and re-save.</span>
            <button className="text-button" style={{ color: '#ffc86b', textDecoration: 'underline', cursor: 'pointer', border: 'none', background: 'transparent' }} onClick={() => {
              try { sessionStorage.removeItem('quantech:unsaved_warning'); } catch {}
              setUnsavedWarning(null);
            }}>Dismiss</button>
          </div>
        )}
        <div className="content-heading"><h1>{section === 'recent' ? 'Recent' : section === 'projects' ? 'Projects' : 'Layouts'}</h1><div className="library-controls"><label className="search-field"><Glyph name="search" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search files" aria-label="Search files" /></label><select aria-label="Sort files" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'edited' | 'name')}><option value="edited">Recently edited</option><option value="name">Name</option></select><div className="view-toggle" aria-label="File view"><button aria-label="Grid view" aria-pressed={fileView === 'grid'} onClick={() => setFileView('grid')}>Grid</button><button aria-label="List view" aria-pressed={fileView === 'list'} onClick={() => setFileView('list')}>List</button></div></div></div>
        {!loaded ? <div className="loading-inline"><span className="spinner" />Loading {cloudDb ? 'cloud' : 'local'} files…</div> : workspaceError ? <div className="workspace-error" role="alert"><strong>Could not load this workspace</strong><span>{workspaceError}</span><button className="button-secondary" onClick={() => void refresh()}>Try again</button></div> : <>
          {(section === 'recent' || section === 'projects') && <section className="home-section"><SectionHeading title={section === 'recent' ? 'Recent projects' : 'All projects'} detail={visibleProjects.length ? `${visibleProjects.length} ${visibleProjects.length === 1 ? 'project' : 'projects'}` : 'Projects you edit will appear here'} action={section === 'recent' && projects.length > 4 ? <button className="text-button" onClick={() => goHome('projects')}>View all →</button> : undefined} />
            {visibleProjects.length ? <>
              <div className={`file-grid recent-grid ${fileView === 'list' ? 'list-view' : ''}`}>{visibleProjects.slice(0, section === 'recent' ? 8 : undefined).map((item) => <ProjectCard key={item.id} project={item} onOpen={() => openProject(item)} onRename={() => void renameProject(item)} onDuplicate={() => void duplicateProject(item)} onDelete={() => void deleteProject(item)} />)}</div>
              {section === 'projects' && hasMoreProjects && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
                  <button className="button-secondary" disabled={loadingMore} onClick={() => void loadMoreProjects()}>
                    {loadingMore ? 'Loading more…' : 'Load more projects'}
                  </button>
                </div>
              )}
            </> : <EmptyState title={query ? 'No matching projects' : 'No projects yet'} text={query ? 'Try a different search.' : 'Create a card and it will be saved here automatically.'} action={!query ? <button className="button-secondary" onClick={() => setShowCreate(true)}>Create your first card</button> : undefined} />}
          </section>}
          {(section === 'recent' || section === 'layouts') && <section className="home-section"><SectionHeading title={section === 'recent' ? 'Your layouts' : 'Saved layouts'} detail={visibleLayouts.length ? `${visibleLayouts.length} reusable ${visibleLayouts.length === 1 ? 'layout' : 'layouts'}` : 'Save a design as a layout from the editor'} action={<><button className="button-secondary" disabled={importingLayouts} onClick={() => layoutImportRef.current?.click()}>{importingLayouts ? 'Importing…' : 'Import layouts'}</button><input ref={layoutImportRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importLayoutFile(file); }} /></>} />
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

function CardPreview({ orientation, background, placeholders = [], thumbnail, variant = 'project' }: {
  orientation: Orientation;
  background?: string;
  placeholders?: CardDocument['placeholders']['front'];
  thumbnail?: string | null;
  variant?: 'project' | 'layout';
}) {
  const ratio = orientation === 'horizontal' ? 'preview-wide' : 'preview-tall';
  const hasPreviewContent = placeholders.length > 0;
  // Background artwork or placeholders alone are valid previews.
  const empty = !thumbnail && !background && !hasPreviewContent;
  const src = makeCardPreviewSvg(orientation, background, placeholders);
  return <div className={`card-preview ${ratio} ${variant}${empty ? ' is-empty' : ''}`} aria-label={`${label(orientation)} card preview`}>
    {empty ? <div className={`empty-card-art ${orientation === 'vertical' ? 'vertical' : ''}`}><span /></div> : <img className="preview-image" src={thumbnail || src} alt="" />}
    <span className="preview-orientation">{label(orientation)} · CR-80</span>
  </div>;
}

function makeCardPreviewSvg(orientation: Orientation, background: string | undefined, fields: CardDocument['placeholders']['front']) {
  const width = orientation === 'horizontal' ? 856 : 540;
  const height = orientation === 'horizontal' ? 540 : 856;
  const esc = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const parts = fields.slice(0, 24).map((field) => {
    const x = Math.max(0, Math.min(width, field.x * width));
    const y = Math.max(0, Math.min(height, field.y * height));
    const w = Math.max(0, Math.min(width - x, field.width * width));
    const h = Math.max(0, Math.min(height - y, field.height * height));
    if (field.type === 'text') {
      const text = field.staticText || (field.key ? (field.key.startsWith('{{') ? field.key : `{{${field.key}}}`) : '');
      if (!text) return '';
      const size = Math.max(9, Math.min(42, Number(field.fontSize) || 16));
      return `<text x="${x}" y="${y + size}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${Number(field.fontWeight) >= 600 ? 600 : 400}" fill="${esc(String(field.color || '#252a31'))}">${esc(text)}</text>`;
    }
    if (field.type === 'photo') {
      const rx = field.shape === 'circle' ? w / 2 : 4;
      const ry = field.shape === 'circle' ? h / 2 : 4;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${ry}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/><line x1="${x}" y1="${y}" x2="${x+w}" y2="${y+h}" stroke="#e2e8f0" stroke-width="1"/><line x1="${x+w}" y1="${y}" x2="${x}" y2="${y+h}" stroke="#e2e8f0" stroke-width="1"/><text x="${x+w/2}" y="${y+h/2+4}" font-family="Arial,sans-serif" font-size="10" fill="#64748b" text-anchor="middle">Photo</text>`;
    }
    if (field.type === 'shape') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${esc(String(field.fill || '#dfe3e8'))}" stroke="${esc(String(field.stroke || '#aeb5c0'))}" stroke-width="2"/>`;
    if (field.type === 'qr') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#d0d4da"/><path d="M${x+w*.1} ${y+h*.1}h${w*.3}v${h*.3}h-${w*.3}z M${x+w*.6} ${y+h*.1}h${w*.3}v${h*.3}h-${w*.3}z M${x+w*.1} ${y+h*.6}h${w*.3}v${h*.3}h-${w*.3}z" fill="#222"/>`;
    return '';
  }).join('');
  const back = background ? `<image href="${esc(background)}" width="${width}" height="${height}" preserveAspectRatio="none"/>` : `<rect width="${width}" height="${height}" fill="#fff"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${back}${parts}<rect x="2" y="2" width="${width-4}" height="${height-4}" rx="24" fill="none" stroke="#d9d9d9" stroke-width="3"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ProjectCard({ project, onOpen, onRename, onDuplicate, onDelete }: { project: ProjectSummary; onOpen: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <article className="file-card"><button className="file-card-open" onClick={onOpen} aria-label={`Open ${project.name}`}>
    <span className="file-card__stage"><CardPreview orientation={project.orientation} background={project.frontBackground} placeholders={project.previewFields} /></span>
    <span className="file-card__footer"><span className="file-card__icon"><Glyph name={project.orientation} size={16} /></span><span className="file-card__copy"><span className="file-card-title">{project.name}</span><span className="file-card-edited">{editedLabel(project.updatedAt)}</span></span><span className="file-card-list-meta">{label(project.orientation)} · CR-80</span></span>
  </button><div className="file-card-menu-wrap"><button className="icon-button file-card-menu" aria-label={`More actions for ${project.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Glyph name="more" /></button>
    {menuOpen && <div className="context-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}>Rename</button><button role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}>Make a copy</button><button role="menuitem" className="danger-action" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete project</button></div>}
  </div></article>;
}

function LayoutCard({ layout, onUse }: { layout: LayoutSummary; onUse: () => void }) {
  return <button className="layout-card" onClick={onUse}><CardPreview orientation={layout.orientation} background={layout.frontBackground} placeholders={layout.previewFields} variant="layout" /><span className="file-card-title">{layout.name}</span><span className="file-card-meta">Saved layout · {label(layout.orientation)}</span><span className="layout-use-label">Use layout <span aria-hidden="true">↗</span></span></button>;
}

function CreateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (orientation: Orientation) => void }) {
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
    <div className="dialog-heading"><div><p className="eyebrow">NEW PROJECT</p><h2 id="create-dialog-title">Create a blank card</h2><p className="muted-copy">Choose a card direction and start with a clean canvas.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><Glyph name="close" /></button></div>
    <div className="choice-row" role="group" aria-label="Card orientation">{(['horizontal', 'vertical'] as const).map((item) => <button key={item} className={`orientation-choice ${orientation === item ? 'selected' : ''}`} onClick={() => setOrientation(item)} aria-pressed={orientation === item}><Glyph name={item} size={20} />{label(item)}</button>)}</div>
    <div className="dialog-footer"><span className="muted-copy">85.6 × 54 mm · CR-80</span><button className="button-primary" onClick={() => onCreate(orientation)}>Create blank card <span aria-hidden="true">→</span></button></div>
  </section></div>;
}

function EditorScreen({ project, onBack, onSave, onSaveLayout }: { project: ProjectRecord; onBack: (section?: Section) => void; onSave: (project: ProjectRecord) => Promise<void>; onSaveLayout: (layout: LayoutRecord) => Promise<void> }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const projectRef = useRef(project);
  const dirtyRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const signatureRef = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const returningRef = useRef(false);
  const [returning, setReturning] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  useEffect(() => { projectRef.current = project; }, [project]);

  const capture = useCallback(async (force = false) => {
    const legacy = frameRef.current?.contentWindow as EditorBridge | null | undefined;
    const getDocumentState = legacy?.getDocumentState;
    if (!legacy || !getDocumentState) return false;
    if (!force && !dirtyRef.current) return true;
    if (inFlight.current) {
      await inFlight.current;
      return capture(force);
    }
    let succeeded = true;
    const task = (async () => {
      try {
        const doc = getDocumentState(projectRef.current.name);
        const signature = JSON.stringify({ orientation: doc.orientation, backgrounds: doc.backgrounds, placeholders: doc.placeholders, templateId: doc.templateId, guides: doc.guides });
        if (!force && signature === signatureRef.current) {
          dirtyRef.current = false;
          setStatus('saved');
          legacy.setSaveStatus?.('Saved');
          return;
        }
        signatureRef.current = signature;
        setStatus('saving');
        legacy.setSaveStatus?.('Saving');
        const saveStart = performance.now();
        const updated: ProjectRecord = { ...projectRef.current, ...doc, kind: 'project', id: projectRef.current.id, name: projectRef.current.name, schemaVersion: 1, createdAt: projectRef.current.createdAt, updatedAt: new Date().toISOString(), thumbnail: null };
        await onSave(updated);
        projectRef.current = updated;
        dirtyRef.current = false;
        setStatus('saved');
        legacy.setSaveStatus?.('Saved');
        console.info(`[Perf] Project save completed in ${(performance.now() - saveStart).toFixed(0)}ms`);
      } catch (error) {
        succeeded = false;
        signatureRef.current = '';
        console.error('Project autosave failed:', error);
        setStatus('error');
        (frameRef.current?.contentWindow as EditorBridge | null)?.setSaveStatus?.('Save failed');
      }
    })();
    inFlight.current = task;
    try { await task; } finally { if (inFlight.current === task) inFlight.current = null; }
    return succeeded;
  }, [onSave]);

  const returnToWorkspace = useCallback(async () => {
    if (returningRef.current) return;
    returningRef.current = true;
    setReturning(true);
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Instant return if no unsaved changes and nothing in flight
    if (!dirtyRef.current && !inFlight.current) {
      onBack('recent');
      return;
    }
    // Bounded save with 3s timeout cap so user is never trapped
    let timedOut = false;
    const savePromise = capture(true);
    const timeoutPromise = new Promise((resolve) => window.setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, 3000));
    try {
      await Promise.race([savePromise, timeoutPromise]);
    } catch (e) {
      console.warn('Return save timed out or threw:', e);
      timedOut = true;
    }
    if (timedOut && dirtyRef.current) {
      try {
        sessionStorage.setItem('quantech:unsaved_warning', projectRef.current.name || 'Your card project');
      } catch {}
    }
    onBack('recent');
  }, [capture, onBack]);

  const onFrameLoad = useCallback(() => {
    const legacy = frameRef.current?.contentWindow as EditorBridge | null | undefined;
    if (!legacy?.loadProjectState) return;
    legacy.loadProjectState(projectRef.current);
    legacy.setDocumentName?.(projectRef.current.name);
    legacy.setSaveStatus?.('Saved');
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const saveOnHide = () => { if (document.visibilityState === 'hidden' && dirtyRef.current) void capture(true); };
    document.addEventListener('visibilitychange', saveOnHide);
    return () => {
      document.removeEventListener('visibilitychange', saveOnHide);
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, [capture]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { type?: string; layout?: LayoutRecord } | null;
      if (payload?.type === 'quantech:doc-changed') {
        dirtyRef.current = true;
        setStatus('dirty');
        (frameRef.current?.contentWindow as EditorBridge | null)?.setSaveStatus?.('Unsaved');
        if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = window.setTimeout(() => {
          debounceTimerRef.current = null;
          void capture();
        }, 1200);
        return;
      }
      if (payload?.type !== 'quantech:layout-saved' || !payload.layout) return;
      const current = projectRef.current;
      const layout = { ...payload.layout, backgroundAssetKeys: {
        front: payload.layout.backgrounds?.front === current.backgrounds.front ? current.backgroundAssetKeys?.front : undefined,
        back: payload.layout.backgrounds?.back === current.backgrounds.back ? current.backgroundAssetKeys?.back : undefined,
      } };
      void onSaveLayout(layout).catch((error) => {
        console.error('Layout sync failed:', error);
        (frameRef.current?.contentWindow as EditorBridge | null)?.setSaveStatus?.('Layout save failed');
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [capture, onSaveLayout]);

  const statusLabel = status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved edits' : status === 'error' ? 'Save failed' : 'All changes saved';

  return (
    <div className="editor-host-shell">
      <header className="editor-host-bar">
        <button className={`back-home-button${returning ? ' is-returning' : ''}`} onClick={() => void returnToWorkspace()} disabled={returning} aria-busy={returning}>
          <Glyph name="back" size={17} />
          <span>{returning ? 'Saving and returning…' : 'Workspace'}</span>
        </button>
        <span className={`editor-host-status status-${status}`} style={{ fontSize: '12px', color: status === 'error' ? 'var(--danger, #e5484d)' : 'var(--muted, #8b949e)', marginLeft: '8px' }}>
          {statusLabel}
        </span>
      </header>
      <iframe ref={frameRef} className="editor-frame" src="/editor.html" title="ID card editor" onLoad={onFrameLoad}/>
    </div>
  );
}
