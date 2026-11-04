import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { performMove } from './actions.ts';
import { kernel } from './kernel/client.ts';
import { useStore } from './store.ts';

// Development only: lets the e2e and debugging scripts look at the kernel and the store, and
// make moves the way the app does (with their animation).
if (import.meta.env.DEV) Object.assign(window, { __paperfold: { kernel, useStore, performMove } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
