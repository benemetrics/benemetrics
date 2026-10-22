import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppChrome } from "./app/AppChrome";
import { Overview } from "./app/pages/Overview";
import { Issues } from "./app/pages/Issues";
import { EventDetail } from "./app/pages/EventDetail";
import { Performance } from "./app/pages/Performance";
import { Logs } from "./app/pages/Logs";
import { Alerts } from "./app/pages/Alerts";
import { NewAlert } from "./app/pages/NewAlert";
import { AlertChannels } from "./app/pages/AlertChannels";
import { ChannelConfig } from "./app/pages/ChannelConfig";
import { Releases } from "./app/pages/Releases";
import { NewRelease } from "./app/pages/NewRelease";
import { ReleaseDetail } from "./app/pages/ReleaseDetail";
import { FeatureFlags } from "./app/pages/FeatureFlags";
import { NewFeatureFlag } from "./app/pages/NewFeatureFlag";
import { Segments } from "./app/pages/Segments";
import { SourceMaps } from "./app/pages/SourceMaps";
import { Permissions } from "./app/pages/Permissions";
import { Projects } from "./app/pages/Projects";
import { Setup } from "./app/pages/Setup";
import { ErrorBoundary } from "./app/ErrorBoundary";

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
          <Route path="/permissions" element={<Permissions />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/setup" element={<Setup />} />
          </Route>
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
