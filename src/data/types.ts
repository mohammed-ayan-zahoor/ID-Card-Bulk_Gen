export type Orientation = 'horizontal' | 'vertical';

export interface CardDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  orientation: Orientation;
  backgrounds: { front?: string; back?: string };
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
