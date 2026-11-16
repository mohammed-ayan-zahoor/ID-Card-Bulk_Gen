import { useCallback, useMemo } from 'react';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import { App } from '../app/App';
import type { WorkspaceAuth } from './types';

export function ClerkBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const getSessionToken = useCallback(async () => await getToken(), [getToken]);
  const accountControl = useMemo(() => isSignedIn
    ? <UserButton appearance={{ variables: { colorPrimary: '#6d60f5', colorBackground: '#292929', colorForeground: '#ededed', colorNeutral: '#ededed', colorInput: '#202020', colorInputForeground: '#ededed' }, elements: { userButtonPopoverCard: { backgroundColor: '#292929', border: '1px solid #454545', boxShadow: '0 16px 42px #0008' }, userButtonPopoverActionButton: { color: '#e7e7e7' }, userButtonPopoverActionButtonText: { color: '#e7e7e7' }, userButtonPopoverFooter: { backgroundColor: '#242424', borderTop: '1px solid #414141' } } }} />
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
