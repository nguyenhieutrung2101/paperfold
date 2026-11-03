/// <reference lib="webworker" />
import { expose } from 'comlink';
import { KernelHost } from './api.ts';

// The kernel runs here so geometry never blocks the UI thread (brief, section 2).
expose(new KernelHost());
