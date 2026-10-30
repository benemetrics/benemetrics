import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import IndexPage from "./routes/index";
import ProjectPage from "./routes/projects/[projectId]/page";
import AppIssuesPage from "./routes/projects/[projectId]/apps/[appId]/page";
import AlertsPage from "./routes/projects/[projectId]/apps/[appId]/alerts/page";
import EventsPage from "./routes/projects/[projectId]/apps/[appId]/events/page";
import FlagPage from "./routes/projects/[projectId]/flags/page";
import LogSetupPage from "./routes/projects/[projectId]/apps/[appId]/log-setup/page";
import IssuePage from "./routes/projects/[projectId]/apps/[appId]/issues/[issueId]/page";
import PerformancePage from "./routes/projects/[projectId]/apps/[appId]/performance/page";
import ReleasesPage from "./routes/projects/[projectId]/apps/[appId]/releases/page";
import SourceMapsPage from "./routes/projects/[projectId]/apps/[appId]/source-maps/page";
import SettingsPage from "./routes/settings/page";
import NotificationsPage from "./routes/notifications/page";
import { RootLayout } from "./components/root-layout";
import { NotFoundPage } from "./components/not-found";
import { LoadingScreen } from "./components/loading-screen";
import { useSession } from "./hooks/use-session";

// Every /ui request resolves the identity — there is no open/dev mode.
// bootstrapOidc() (main.tsx) redirects into the provider before the router
// renders, so "unauthenticated" below is only a transient redirect state;
// scoped view renders the same screens filtered server-side (the UI never
// guesses its scope).
function SessionGate() {
  const { status, session } = useSession();
  if (status === "loading") return <LoadingScreen />;
  if (status === "unauthenticated") return <LoadingScreen />;
  return (
    <RootLayout session={session}>
      <Outlet />
    </RootLayout>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <SessionGate />,
      children: [
        { path: "/", element: <IndexPage /> },
        // The pre-rewrite entry path; after an OIDC callback the browser
        // lands here, so it renders the same projects screen as "/".
        { path: "/overview", element: <IndexPage /> },
        // The OIDC redirect target: bootstrapOidc() exchanges the code and
        // reloads before the router renders, so the element stays empty.
        { path: "/auth/callback", element: null },
        { path: "/projects/:projectId", element: <ProjectPage /> },
        { path: "/projects/:projectId/flags", element: <FlagPage /> },
        {
          path: "/projects/:projectId/apps/:appId",
          element: <AppIssuesPage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/alerts",
          element: <AlertsPage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/events",
          element: <EventsPage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/log-setup",
          element: <LogSetupPage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/issues/:issueId",
          element: <IssuePage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/performance",
          element: <PerformancePage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/releases",
          element: <ReleasesPage />,
        },
        {
          path: "/projects/:projectId/apps/:appId/source-maps",
          element: <SourceMapsPage />,
        },
        { path: "/settings", element: <SettingsPage /> },
        { path: "/notifications", element: <NotificationsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: "/ui" },
);

export function App() {
  return <RouterProvider router={router} />;
}
