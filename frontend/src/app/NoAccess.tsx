import { useWorkspace } from "./WorkspaceContext";

export function NoAccess() {
  const { noAccess } = useWorkspace();

  if (!noAccess) return null;

  return (
    <div className="no-access">
      <h2>No read access granted</h2>
      <p>
        Your identity has been granted read access, but the grant includes no
        environments or applications. An administrator must update your grant
        to include the resources you should see.
      </p>
      <p className="no-access-hint">
        This is different from having no grant at all — in that case you would
        be prompted for the admin token. Here, your identity is recognized but
        the scope is empty.
      </p>
    </div>
  );
}