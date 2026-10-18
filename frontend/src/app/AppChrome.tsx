import { Outlet } from "react-router-dom";
import { WorkspaceProvider } from "./WorkspaceContext.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { AuthPrompt } from "./AuthPrompt.tsx";
import { Topbar } from "./Topbar.tsx";
import { MobileNavBar } from "./MobileNavBar.tsx";
import { Toaster } from "./Toaster.tsx";

export function AppChrome() {
  return (
    <WorkspaceProvider>
      <div className="app-shell">
        <AppSidebar />
        <div className="main">
          <AuthPrompt />
          <Topbar />
          <div className="page">
            <Outlet />
          </div>
        </div>
        <MobileNavBar />
        <Toaster />
      </div>
    </WorkspaceProvider>
  );
}
