import { Outlet } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileNavBar } from "./MobileNavBar";
import { Toaster } from "./Toaster";
import { AuthPrompt } from "./AuthPrompt";
import { NoAccess } from "./NoAccess";

function AppContent() {
  const { noAccess } = useWorkspace();
  return noAccess ? <NoAccess /> : <Outlet />;
}

export function AppChrome() {
  return (
    <WorkspaceProvider>
      <div className="app-shell">
        <AppSidebar />
        <div className="main">
          <Topbar />
          <div className="page">
            <AppContent />
          </div>
        </div>
        <MobileNavBar />
        <Toaster />
        <AuthPrompt />
      </div>
    </WorkspaceProvider>
  );
}
