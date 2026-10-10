import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EventPage } from './pages/EventPage';
import { StatusPage } from './pages/StatusPage';
import { NotFoundPage } from './pages/NotFoundPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/e/:slug" element={<EventPage />} />
        <Route path="/t/:token" element={<StatusPage />} />
        <Route path="/" element={<Navigate to="/not-found" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
