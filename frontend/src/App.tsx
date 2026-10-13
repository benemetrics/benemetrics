import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { IssuesTriage } from './pages/IssuesTriage';
import { Performance } from './pages/Performance';
import { IssueDetail } from './pages/IssueDetail';
import { APIDemo } from './components/APIDemo';
import { AdminProjects, ProjectDetail } from './pages/Admin';
import { PageShell } from './components/PageShell';

export function App() {
  return (
    <BrowserRouter basename="/ui">
      <div className="min-h-screen bg-surface">
        <Routes>
          <Route path="/" element={<Navigate to="/issues" replace />} />
          <Route path="/issues" element={<IssuesTriage />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/replays" element={<ReplaysPage />} />
          <Route path="/issue/:id" element={<IssueDetail />} />
          <Route path="/api-demo" element={<APIDemo />} />
          <Route path="/admin" element={<AdminProjects />} />
          <Route path="/admin/projects/:id" element={<ProjectDetail />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function ReplaysPage() {
  return (
    <PageShell narrow>
      <div className="py-10 flex flex-col items-center gap-3 text-center">
        <span className="material-symbols-outlined text-[36px] text-outline">slow_motion_video</span>
        <h1 className="text-headline-md text-on-surface font-bold">Session Replays</h1>
        <p className="text-on-surface-variant">Session replay viewer coming soon.</p>
      </div>
    </PageShell>
  );
}