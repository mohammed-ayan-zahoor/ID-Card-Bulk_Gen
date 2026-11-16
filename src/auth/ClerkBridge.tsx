import { useCallback, useMemo } from 'react';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import { App } from '../app/App';
import type { WorkspaceAuth } from './types';

export function ClerkBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const getSessionToken = useCallback(async () => await getToken(), [getToken]);
  const accountControl = useMemo(() => isSignedIn
    ? <UserButton />
    : <SignInButton mode="modal"><button className="auth-sign-in">Sign in</button></SignInButton>, [isSignedIn]);
  const auth: WorkspaceAuth = {
    clerkConfigured: true,
    loaded: isLoaded,
    signedIn: Boolean(isSignedIn),
    userId: userId ?? null,
    getToken: getSessionToken,
    accountControl: isLoaded ? accountControl : null,
  };

  return <App key={userId ?? 'signed-out'} auth={auth} accountName={user?.firstName || user?.primaryEmailAddress?.emailAddress || null} />;
}
