import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppChrome } from "./app/AppChrome.tsx";
import { Overview } from "./app/pages/Overview.tsx";
import { Issues } from "./app/pages/Issues.tsx";
import { EventDetail } from "./app/pages/EventDetail.tsx";
import { Performance } from "./app/pages/Performance.tsx";
import { Logs } from "./app/pages/Logs.tsx";
import { Alerts } from "./app/pages/Alerts.tsx";
import { NewAlert } from "./app/pages/NewAlert.tsx";
import { AlertChannels } from "./app/pages/AlertChannels.tsx";
import { ChannelConfig } from "./app/pages/ChannelConfig.tsx";
import { Releases } from "./app/pages/Releases.tsx";
import { NewRelease } from "./app/pages/NewRelease.tsx";
import { ReleaseDetail } from "./app/pages/ReleaseDetail.tsx";
import { FeatureFlags } from "./app/pages/FeatureFlags.tsx";
import { NewFeatureFlag } from "./app/pages/NewFeatureFlag.tsx";
import { Segments } from "./app/pages/Segments.tsx";
import { SourceMaps } from "./app/pages/SourceMaps.tsx";
import { Projects } from "./app/pages/Projects.tsx";
import { Setup } from "./app/pages/Setup.tsx";
import { Settings } from "./app/pages/Settings.tsx";
import { ErrorBoundary } from "./app/ErrorBoundary.tsx";

export function App() {
  return (
    <BrowserRouter basename="/ui">
      <ErrorBoundary>
        <Routes>
          <Route element={<AppChrome />}>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/issues/:eventId" element={<EventDetail />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/alerts/new" element={<NewAlert />} />
            <Route path="/alerts/channels" element={<AlertChannels />} />
            <Route path="/alerts/channels/:channelId" element={<ChannelConfig />} />
            <Route path="/releases" element={<Releases />} />
            <Route path="/releases/new" element={<NewRelease />} />
            <Route path="/releases/:releaseId" element={<ReleaseDetail />} />
            <Route path="/feature-flags" element={<FeatureFlags />} />
            <Route path="/feature-flags/new" element={<NewFeatureFlag />} />
            <Route path="/segments" element={<Segments />} />
            <Route path="/source-maps" element={<SourceMaps />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/setup" element={<Setup />} />
          </Route>
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
