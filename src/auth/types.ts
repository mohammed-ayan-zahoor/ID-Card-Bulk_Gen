import type { ReactNode } from 'react';

export interface WorkspaceAuth {
  clerkConfigured: boolean;
  loaded: boolean;
  signedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
  accountControl: ReactNode;
}
