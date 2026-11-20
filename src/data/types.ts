export type Orientation = 'horizontal' | 'vertical';

export interface CardDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  orientation: Orientation;
  backgrounds: { front?: string; back?: string };
  /** Private Storage object keys for cloud-backed backgrounds. */
  backgroundAssetKeys?: { front?: string; back?: string };
  placeholders: { front: CardPlaceholder[]; back: CardPlaceholder[] };
  createdAt: string;
  updatedAt: string;
  templateId?: string;
  thumbnail?: string | null;
}

export interface CardPlaceholder {
  id?: string;
  type: 'text' | 'photo' | 'qr' | 'shape';
  key?: string;
  /** Private Storage object key for a cloud-backed custom image. */
  imageAssetKey?: string;
  staticText?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface ProjectRecord extends CardDocument {
  kind: 'project';
}

export interface WorkspacePageCursor {
  value: string;
  id: string;
}

export type WorkspaceSort = 'edited' | 'name';

export interface WorkspacePage<T> {
  items: T[];
  nextCursor: WorkspacePageCursor | null;
  hasMore: boolean;
}

export interface ProjectSummary {
  kind: 'project';
  id: string;
  name: string;
  orientation: Orientation;
  createdAt: string;
  updatedAt: string;
  frontBackground?: string;
  previewFields: CardPlaceholder[];
}

export interface LayoutRecord {
  schemaVersion: 1;
  kind: 'layout';
  id: string;
  name: string;
  orientation: Orientation;
  backgrounds?: { front?: string; back?: string };
  placeholders: { front: CardPlaceholder[]; back: CardPlaceholder[] };
  createdAt: string;
  updatedAt: string;
  /** Present on layouts written by the pre-IndexedDB editor. */
  dateCreated?: string;
  templateId?: string;
  thumbnail?: string | null;
  /** Private Storage object keys for cloud-backed backgrounds. */
  backgroundAssetKeys?: { front?: string; back?: string };
}

export interface LayoutSummary {
  kind: 'layout';
  id: string;
  name: string;
  orientation: Orientation;
  createdAt: string;
  updatedAt: string;
  frontBackground?: string;
  previewFields: CardPlaceholder[];
}

export type WorkspaceRecord = ProjectRecord | LayoutRecord;

export const makeId = (prefix: string) => {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${uuid}`;
};

export const emptyDocument = (orientation: Orientation, name = 'Untitled card'): CardDocument => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: makeId('project'),
    name,
    orientation,
    backgrounds: {},
    placeholders: { front: [], back: [] },
    createdAt: now,
    updatedAt: now,
    templateId: 'blank',
  };
};

export function projectToSummary(project: ProjectRecord): ProjectSummary {
  return {
    kind: 'project',
    id: project.id,
    name: project.name,
    orientation: project.orientation,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    frontBackground: project.backgrounds?.front,
    previewFields: (project.placeholders?.front || []).slice(0, 24).map((f) => ({
      id: f.id,
      type: f.type,
      key: f.key,
      staticText: f.staticText,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      fontSize: f.fontSize,
      fontWeight: f.fontWeight,
      color: f.color,
      fill: f.fill,
      stroke: f.stroke,
    })),
  };
}

export function layoutToSummary(layout: LayoutRecord): LayoutSummary {
  return {
    kind: 'layout',
    id: layout.id,
    name: layout.name,
    orientation: layout.orientation,
    createdAt: layout.createdAt,
    updatedAt: layout.updatedAt,
    frontBackground: layout.backgrounds?.front,
    previewFields: (layout.placeholders?.front || []).slice(0, 24).map((f) => ({
      id: f.id,
      type: f.type,
      key: f.key,
      staticText: f.staticText,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      fontSize: f.fontSize,
      fontWeight: f.fontWeight,
      color: f.color,
      fill: f.fill,
      stroke: f.stroke,
    })),
  };
}
