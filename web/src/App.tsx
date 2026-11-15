import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { CalendarPage } from './pages/CalendarPage';
import { TimelinePage } from './pages/TimelinePage';
import { EntryEditPage } from './pages/EntryEditPage';
import { TagsPage } from './pages/TagsPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';

// 健康页懒加载：recharts 仅在访问 /health 时加载
const HealthPage = lazy(() => import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })));
const HealthSleepPage = lazy(() => import('./pages/HealthSleepPage').then((m) => ({ default: m.HealthSleepPage })));

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-neutral-400">
      <div className="animate-pulse">加载中…</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anon') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<CalendarPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/entries/new" element={<EntryEditPage />} />
          <Route path="/entries/:id" element={<EntryEditPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route
            path="/health"
            element={
              <Suspense fallback={<FullScreenLoader />}>
                <HealthPage />
              </Suspense>
            }
          />
          <Route
            path="/health/sleep"
            element={
              <Suspense fallback={<FullScreenLoader />}>
                <HealthSleepPage />
              </Suspense>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
