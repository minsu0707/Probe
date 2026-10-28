import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { initTheme } from './core/theme.ts';
// Order matters: tokens first (variables), responsive last (overrides).
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/pages/services.css';
import './styles/pages/learn.css';
import './styles/pages/monitor.css';
import './styles/pages/results.css';
import './styles/pages/sessions.css';
import './styles/pages/overview.css';
import './styles/responsive.css';
import './styles/motion.css';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
