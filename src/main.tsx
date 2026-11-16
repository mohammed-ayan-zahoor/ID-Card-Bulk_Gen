import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ClerkProvider } from '@clerk/react';
import { ClerkBridge } from './auth/ClerkBridge';
import './styles/workspace.css';

const root = createRoot(document.getElementById('root')!);
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

root.render(<React.StrictMode>
  {publishableKey
    ? <ClerkProvider publishableKey={publishableKey} appearance={{ variables: { colorPrimary: '#5b4cf0', colorBackground: '#303030', colorForeground: '#d2d2d2', colorInput: '#2e2e2e', colorInputForeground: '#d2d2d2' } }}><ClerkBridge /></ClerkProvider>
    : <App />}
</React.StrictMode>);
