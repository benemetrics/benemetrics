import { Outlet } from "react-router-dom";
import { WorkspaceProvider } from "./WorkspaceContext";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileNavBar } from "./MobileNavBar";
import { Toaster } from "./Toaster";

export function AppChrome() {
  return (
    <WorkspaceProvider>
      <div className="app-shell">
        <AppSidebar />
        <div className="main">
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
