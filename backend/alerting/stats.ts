/**
 * The alerting counters — what the evaluation did, for the admin API and
 * the operators watching the delivery.
 */
export interface AlertingStats {
  rulesEvaluated: number;
  incidentsFired: number;
  incidentsResolved: number;
  deliveriesSucceeded: number;
  deliveriesFailed: number;
  cooldownsSkipped: number;
}

const counters: AlertingStats = {
  rulesEvaluated: 0,
  incidentsFired: 0,
  incidentsResolved: 0,
  deliveriesSucceeded: 0,
  deliveriesFailed: 0,
  cooldownsSkipped: 0,
};

export function countRuleEvaluated(): void {
  counters.rulesEvaluated += 1;
}

export function countIncidentFired(): void {
  counters.incidentsFired += 1;
}

export function countIncidentResolved(): void {
  counters.incidentsResolved += 1;
}

export function countDelivery(succeeded: boolean): void {
  if (succeeded) counters.deliveriesSucceeded += 1;
  else counters.deliveriesFailed += 1;
}

export function countCooldownSkipped(): void {
  counters.cooldownsSkipped += 1;
}

export function readAlertingStats(): AlertingStats {
  return { ...counters };
}
