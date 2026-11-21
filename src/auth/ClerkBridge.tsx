import { useCallback, useEffect, useMemo, useRef } from 'react';
import { SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import { App } from '../app/App';
import type { WorkspaceAuth } from './types';

const USER_BUTTON_APPEARANCE = {
  variables: {
    colorPrimary: '#6d60f5',
    colorBackground: '#292929',
    colorForeground: '#ededed',
    colorNeutral: '#ededed',
    colorInput: '#202020',
    colorInputForeground: '#ededed',
  },
  elements: {
    userButtonPopoverCard: {
      backgroundColor: '#292929',
      border: '1px solid #454545',
      boxShadow: '0 16px 42px #0008',
    },
    userButtonPopoverActionButton: { color: '#e7e7e7' },
    userButtonPopoverActionButtonText: { color: '#e7e7e7' },
    userButtonPopoverFooter: {
      backgroundColor: '#242424',
      borderTop: '1px solid #414141',
    },
  },
};

export function ClerkBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();

  // Stable token getter avoids recreating the Supabase client when Clerk refreshes its internal reference
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  const getSessionToken = useCallback(async () => await getTokenRef.current(), []);

  const accountControl = useMemo(() => (
    isSignedIn
      ? <UserButton appearance={USER_BUTTON_APPEARANCE} />
      : <SignInButton mode="modal"><button className="auth-sign-in">Sign in</button></SignInButton>
  ), [isSignedIn]);

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
