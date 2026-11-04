import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  AuthProvider,
  RequireAuth,
  RequireSuperAdmin,
  RequireWorkspace,
} from './lib/auth';
import { AdminLayout } from './components/AdminLayout';
import { PlatformLayout } from './components/PlatformLayout';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PlatformPage } from './pages/PlatformPage';
import { DashboardPage } from './pages/DashboardPage';
import { EntriesPage } from './pages/EntriesPage';
import { ReconcilePage } from './pages/ReconcilePage';
import { EventsPage } from './pages/EventsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ActivityPage } from './pages/ActivityPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Forced on first sign-in with an issued password; also voluntary. */}
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                {/* Organizer passwords are set by the super admin only. */}
                <RequireSuperAdmin>
                  <ChangePasswordPage />
                </RequireSuperAdmin>
              </RequireAuth>
            }
          />

          {/* Super admin console. */}
          <Route
            element={
              <RequireAuth>
                <RequireSuperAdmin>
                  <PlatformLayout />
                </RequireSuperAdmin>
              </RequireAuth>
            }
          >
            <Route path="/platform" element={<PlatformPage />} />
          </Route>

          {/* Organizer workspace. */}
          <Route
            element={
              <RequireAuth>
                <RequireWorkspace>
                  <AdminLayout />
                </RequireWorkspace>
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/entries" element={<EntriesPage />} />
            <Route path="/reconcile" element={<ReconcilePage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
