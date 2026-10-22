import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/App';
import { bootstrapOidc } from './src/lib/oidc';

const root = createRoot(document.getElementById('root')!);

// Resolve the auth mode before rendering: an active OIDC provider sends the
// browser into the authorization-code flow from startup; otherwise the app
// renders and the admin-token prompt handles a 401.
void bootstrapOidc().finally(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
