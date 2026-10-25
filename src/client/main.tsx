import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/board.css';
import './styles/timeline.css';
import './styles/pages.css';
import './styles/features.css';
import './styles/planning.css';
import { ApiError } from './api/client';
import { App } from './App';
import { ConfirmProvider, ToastProvider } from './components/Feedback';
import { ThemeProvider } from './lib/theme';
import { LanguageProvider } from './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't retry requests the server rejected on purpose (4xx).
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
