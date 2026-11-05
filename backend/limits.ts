// "Scan everything this project owns" caps: broad enough to cover real
// usage, narrow enough to bound a misconfigured deployment.
export const FULL_SCAN_LIMIT = 1000;

// Alerting reads enumerate every channel/rule of a scope in one pass.
export const ALERT_LIST_LIMIT = 200;
