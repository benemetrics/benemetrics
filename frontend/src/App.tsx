import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MobileNavBar } from './components/MobileNavBar';
import { IssuesTriage } from './pages/IssuesTriage';
import { Performance } from './pages/Performance';
import { IssueDetail } from './pages/IssueDetail';
import { Setup } from './pages/Setup';

const navLinks = [
  { path: '/issues', label: 'Issues', icon: 'bug_report' },
  { path: '/performance', label: 'Perf', icon: 'speed' },
  { path: '/replays', label: 'Replays', icon: 'play_circle' },
  { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
];

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-surface">
        <Routes>
          <Route path="/" element={<Navigate to="/issues" replace />} />
          <Route path="/issues" element={<IssuesTriage />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/replays" element={<ReplaysPage />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/issue/:id" element={<IssueDetail />} />
        </Routes>
        <MobileNavBar links={navLinks} />
      </div>
    </BrowserRouter>
  );
}

function ReplaysPage() {
  return (
    <div className="p-4">
      <h1 className="text-headline-md text-on-surface mb-4">Session Replays</h1>
      <p className="text-on-surface-variant">Session replay viewer coming soon.</p>
    </div>
  );
}