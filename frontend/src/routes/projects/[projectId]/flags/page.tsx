import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FlaskConical, TrendingDown, TrendingUp, Plus } from "lucide-react";
import { useProject } from "../../../../hooks/use-projects";
import {
  useFlags,
  type FlagRecord,
  type ExperimentResultRecord,
} from "../../../../hooks/use-flags";
import { Btn, Crumbs, Pill, Toggle } from "../../../../components/ui-kit";
import { cn } from "../../../../lib/utils";
import { FlagTargeting } from "../../../../components/flag-targeting";
import {
  toUiRules,
  toApiRules,
  type ApiTargetingRule,
} from "../../../../lib/flag-targeting";
import type { TargetingRule } from "../../../../lib/data";
import type { LiveFeedStatus } from "../../../../lib/live-events";
import { LoadingScreen } from "../../../../components/loading-screen";
import { NotFoundPage } from "../../../../components/not-found";
import { FlagForm } from "../../../../components/create-forms";

// Flags belong to the project (optionally narrowed to one app); this screen
// lists the project-wide surface — every app of the project inherits these.
export default function ProjectFlagsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ProjectFlagsInner projectId={projectId} />;
}

function ProjectFlagsInner({ projectId }: { projectId: string }) {
  const { detail, notFound } = useProject(projectId);
  const {
    flags,
    results,
    loading,
    live,
    reload,
    setStatus,
    setRollout,
    setTargetingRules,
  } = useFlags(projectId, undefined);
  // Local rollout values while the slider drags; the PATCH fires on release.
  const [draftRollout, setDraftRollout] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    document.title = "Feature flags — Glitchlog";
  }, []);

  if (notFound) return <NotFoundPage />;
  if (!detail) return <LoadingScreen />;

  return (
    <div className="space-y-4">
      <Crumbs
        items={[
          { label: "projects", to: "/" },
          { label: detail.slug, to: `/projects/${projectId}` },
          { label: "flags" },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Feature flags</h1>
          <p className="text-sm text-muted-foreground">
            Shared by every app in {detail.name}.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" />
          New flag
        </Btn>
      </div>
      {creating && (
        <FlagForm
          projectId={projectId}
          existingKeys={(flags ?? []).map((f) => f.key)}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
      {loading ? <LoadingScreen /> : null}
      {!loading && (flags ?? []).length === 0 && (
        <div className="panel p-6 text-center font-mono text-sm text-muted-foreground">
          No feature flags yet.
        </div>
      )}
      {(flags ?? []).map((f: FlagRecord) => (
        <FlagCard
          key={f.id}
          flag={f}
          live={live}
          result={results[f.id]}
          draftRollout={draftRollout[f.id]}
          setDraft={(v) => setDraftRollout((d) => ({ ...d, [f.id]: v }))}
          fireRollout={(v) => {
            if (v !== undefined && v !== f.rolloutPercentage) setRollout(f.id, v);
          }}
          setStatus={setStatus}
          setTargetingRules={setTargetingRules}
        />
      ))}
    </div>
  );
}

function FlagCard({
  flag: f,
  live,
  result,
  draftRollout,
  setDraft,
  fireRollout,
  setStatus,
  setTargetingRules,
}: {
  flag: FlagRecord;
  live: LiveFeedStatus;
  result: ExperimentResultRecord | undefined;
  draftRollout: number | undefined;
  setDraft: (v: number) => void;
  fireRollout: (v: number | undefined) => void;
  setStatus: (flagId: string, status: FlagRecord["status"]) => Promise<boolean>;
  setTargetingRules: (
    flagId: string,
    rules: Array<{
      attribute: string;
      operator: string;
      value: unknown;
      variantKey?: string;
    }>,
  ) => Promise<boolean>;
}) {
  const byKey = new Map((result?.variants ?? []).map((v) => [v.key, v]));
  const treatment = byKey.get(
    f.variants.find((v) => v.key !== "control")?.key ?? "",
  );
  const lift = treatment?.relativeImprovement;
  const winner = result?.recommendation.winner === f.key;
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-bold">{f.key}</span>
            {winner && <Pill tone="primary">winner</Pill>}
            {f.status === "draft" && <Pill>draft</Pill>}
            {!f.appId && <Pill>project-wide</Pill>}
            {f.appId && <Pill>app-scoped</Pill>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
        </div>
        <Toggle
          on={f.status === "active"}
          label={`Toggle ${f.key}`}
          onChange={(v: boolean) => setStatus(f.id, v ? "active" : "paused")}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="w-16 font-mono text-[11px] text-muted-foreground">
          rollout
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draftRollout ?? f.rolloutPercentage}
          disabled={f.status !== "active"}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => fireRollout(draftRollout)}
          onKeyUp={() => fireRollout(draftRollout)}
          className="flex-1 accent-primary"
          aria-label="Rollout percentage"
        />
        <span className="w-10 text-right font-mono text-sm">
          {draftRollout ?? f.rolloutPercentage}%
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[460px] font-mono text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">variant</th>
              <th className="font-normal">exposures</th>
              <th className="font-normal">
                {f.experiment?.primaryMetric ?? "conversion"}
              </th>
              <th className="font-normal">error rate</th>
            </tr>
          </thead>
          <tbody>
            {!result && (
              <tr>
                <td colSpan={4} className="py-2 text-muted-foreground">
                  No experiment running for this flag.
                </td>
              </tr>
            )}
            {f.variants.map((v) => {
              const r = byKey.get(v.key);
              return (
                <tr key={v.key} className="border-t">
                  <td className="py-2">
                    {v.key}{" "}
                    <span className="text-muted-foreground">{v.weight}%</span>
                  </td>
                  <td>{r ? r.participants : "—"}</td>
                  <td>
                    {r ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.min(100, r.conversionRate * 1000)}%`,
                            }}
                          />
                        </div>
                        {(r.conversionRate * 100).toFixed(2)}%
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {lift !== undefined && (
          <span
            className={cn(
              "flex items-center gap-1 font-mono",
              lift >= 0 ? "text-primary" : "text-destructive",
            )}
          >
            {lift >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {lift >= 0 ? "+" : ""}
            {(lift * 100).toFixed(1)}% lift
          </span>
        )}
        {result && (
          <span>
            confidence{" "}
            <span
              className={cn(
                "font-mono",
                result.recommendation.confidence === "high"
                  ? "text-primary"
                  : "text-warning",
              )}
            >
              {result.recommendation.confidence}
            </span>
          </span>
        )}
        <span className="flex items-center gap-2 font-mono">
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-primary",
              live === "connected" && "animate-pulse",
            )}
          />
          live
        </span>
        <span>updated {new Date(f.updatedAt).toLocaleDateString()}</span>
      </div>
      <FlagTargeting
        flagKey={f.key}
        variants={f.variants}
        rules={toUiRules((f.targetingRules ?? []) as ApiTargetingRule[])}
        onPersist={async (rules: TargetingRule[]) => setTargetingRules(f.id, toApiRules(rules))}
      />
    </div>
  );
}
