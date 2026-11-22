import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ToastProvider } from './components/ui';
import { initNet } from './net';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<div className="flex h-full items-center justify-center text-white/60">Loading Estate Empire…</div>);

initNet().then(() => {
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );
});
