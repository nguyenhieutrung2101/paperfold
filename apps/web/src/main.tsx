import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { kernel } from './kernel/client.ts';
import { useStore } from './store.ts';

// Development only: lets the e2e and debugging scripts look at the kernel and the store.
if (import.meta.env.DEV) Object.assign(window, { __paperfold: { kernel, useStore } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
