import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FlaskConical, TrendingDown, TrendingUp } from "lucide-react";
import {
  useFlags,
  type FlagRecord,
  type ExperimentResultRecord,
} from "../../../../../../hooks/use-flags";
import { Pill, Toggle } from "../../../../../../components/ui-kit";
import { cn } from "../../../../../../lib/utils";
import { FlagTargeting } from "../../../../../../components/flag-targeting";
import {
  toUiRules,
  toApiRules,
  type ApiTargetingRule,
} from "../../../../../../lib/flag-targeting";
import type { TargetingRule } from "../../../../../../lib/data";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";

function FlagsInner({
  projectId,
  appId,
}: {
  projectId: string;
  appId: string;
}) {
  const {
    flags,
    results,
    loading,
    live,
    setStatus,
    setRollout,
    setTargetingRules,
  } = useFlags(projectId, appId);
  // Local rollout values while the slider drags; the PATCH fires on release.
  const [draftRollout, setDraftRollout] = useState<Record<string, number>>({});

  useEffect(() => {
    document.title = `Flags & A/B — Glitchlog`;
  }, []);

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-4">
      <span className="flex items-center justify-end gap-2 font-mono text-xs text-muted-foreground">
        <span
          className={cn(
            "h-2 w-2 rounded-full bg-primary",
            live === "connected" && "animate-pulse",
          )}
        />{" "}
        live
      </span>
      {(flags ?? []).length === 0 && (
        <div className="panel p-6 text-center font-mono text-sm text-muted-foreground">
          No feature flags for this app.
        </div>
      )}
      {(flags ?? []).map((f: FlagRecord) => {
        const result: ExperimentResultRecord | undefined = results[f.id];
        const byKey = new Map((result?.variants ?? []).map((v) => [v.key, v]));
        const control = byKey.get("control");
        const treatment = byKey.get(
          f.variants.find((v) => v.key !== "control")?.key ?? "",
        );
        const lift = treatment?.relativeImprovement;
        const winner = result?.recommendation.winner === f.key;
        return (
          <div key={f.key} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm font-bold">{f.key}</span>
                  {winner && <Pill tone="primary">winner</Pill>}
                  {f.status === "draft" && <Pill>draft</Pill>}
                  {f.status === "paused" && <Pill tone="warning">paused</Pill>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {f.description}
                </p>
              </div>
              <Toggle
                on={f.status === "active"}
                label={`Toggle ${f.key}`}
                onChange={(v: boolean) =>
                  setStatus(f.id, v ? "active" : "paused")
                }
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
                value={draftRollout[f.id] ?? f.rolloutPercentage}
                disabled={f.status !== "active"}
                onChange={(e) =>
                  setDraftRollout((d) => ({
                    ...d,
                    [f.id]: Number(e.target.value),
                  }))
                }
                onPointerUp={() => {
                  const v = draftRollout[f.id];
                  if (v !== undefined && v !== f.rolloutPercentage)
                    setRollout(f.id, v);
                }}
                onKeyUp={() => {
                  const v = draftRollout[f.id];
                  if (v !== undefined && v !== f.rolloutPercentage)
                    setRollout(f.id, v);
                }}
                className="flex-1 accent-primary"
                aria-label="Rollout percentage"
              />
              <span className="w-10 text-right font-mono text-sm">
                {draftRollout[f.id] ?? f.rolloutPercentage}%
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
                  {f.variants.map((v) => {
                    const r = byKey.get(v.key);
                    return (
                      <tr key={v.key} className="border-t">
                        <td className="py-2">
                          {v.key}{" "}
                          <span className="text-muted-foreground">
                            {v.weight}%
                          </span>
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
              {f.appId ? <span>app-scoped</span> : <span>project-scoped</span>}
              <span>updated {new Date(f.updatedAt).toLocaleDateString()}</span>
            </div>
            <FlagTargeting
              flagKey={f.key}
              variants={f.variants}
              rules={toUiRules((f.targetingRules ?? []) as ApiTargetingRule[])}
              onPersist={async (rules: TargetingRule[]) =>
                setTargetingRules(f.id, toApiRules(rules))
              }
            />
          </div>
        );
      })}
    </div>
  );
}

export default function FlagsPage() {
  const { projectId, appId } = useParams<{
    projectId: string;
    appId: string;
  }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <FlagsInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}
