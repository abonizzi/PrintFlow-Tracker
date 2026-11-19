import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={qc}><App /></QueryClientProvider></React.StrictMode>
);
