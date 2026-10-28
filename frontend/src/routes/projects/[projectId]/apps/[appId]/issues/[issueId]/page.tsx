import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useIssue } from "../../../../../../../hooks/use-issue";
import { IssueDetail } from "../../../../../../../components/issue-detail";
import { AppLayout } from "../../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../../components/loading-screen";
import { NotFoundPage } from "../../../../../../../components/not-found";

export default function IssuePage() {
  const { projectId, appId, issueId } = useParams<{ projectId: string; appId: string; issueId: string }>();
  if (!projectId || !appId || !issueId) return null;
  return (
    <AppLayout>
      <IssueDetailPage issueId={issueId} />
    </AppLayout>
  );
}

function IssueDetailPage({ issueId }: { issueId: string }) {
  const { issue, notFound, loading, updateStatus } = useIssue(issueId);
  const [status, setStatus] = useState<string>("unresolved");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (issue) setStatus(issue.status);
  }, [issue]);

  useEffect(() => {
    if (issue) document.title = `${issue.fingerprint.slice(0, 8)} · ${issue.type} — Glitchlog`;
  }, [issue]);

  if (loading) return <LoadingScreen />;
  if (notFound || !issue) return <NotFoundPage />;

  // The backend knows only unresolved/resolved; "ignored" stays a UI-only
  // state until the protocol grows it, so it never hits the API.
  const onStatus = async (s: "unresolved" | "resolved" | "ignored") => {
    if (s === "ignored" || saving) return;
    setSaving(true);
    const ok = await updateStatus(s);
    setSaving(false);
    if (ok) setStatus(s);
  };

  return (
    <div className="panel max-w-3xl p-5">
      <IssueDetail issue={issue} status={status} onStatus={onStatus} />
    </div>
  );}
