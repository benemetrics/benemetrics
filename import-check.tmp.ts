process.env.ADMIN_TOKEN = "e2e-admin-token";
import { ADMIN_HEADERS, handleFetch as fetch, TEST_ORIGIN } from "./backend/tests/test-helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

const project = await (await fetch(`${TEST_ORIGIN}/api/admin/projects`, {
  method: "POST",
  headers: ADMIN_HEADERS,
  body: JSON.stringify({ name: `Imp ${uniq()}` }),
})).json() as { id: string };
const app = await (await fetch(`${TEST_ORIGIN}/api/admin/projects/${project.id}/apps`, {
  method: "POST",
  headers: ADMIN_HEADERS,
  body: JSON.stringify({ name: `App ${uniq()}` }),
})).json() as { id: string };

await fetch(`${TEST_ORIGIN}/api/admin/alerting/rules`, {
  method: "POST",
  headers: ADMIN_HEADERS,
  body: JSON.stringify({
    name: `exported ${uniq()}`,
    metric: "error_count",
    operator: "gt",
    threshold: 3,
    windowSeconds: 3600,
    appId: app.id,
  }),
});

const exportRes = await fetch(`${TEST_ORIGIN}/api/admin/alerting/export`, {
  headers: ADMIN_HEADERS,
});
console.log("export status:", exportRes.status);
const exported = await exportRes.json() as any;
console.log("exported rule:", JSON.stringify(exported.rules[0], null, 2));

const res = await fetch(`${TEST_ORIGIN}/api/admin/alerting/import`, {
  method: "POST",
  headers: ADMIN_HEADERS,
  body: JSON.stringify({
    version: 1,
    rules: [
      ...exported.rules,
      {
        name: `imported ${uniq()}`,
        metric: "error_count",
        operator: "gt",
        threshold: 5,
        windowSeconds: 600,
      },
    ],
  }),
});
console.log("import status:", res.status);
console.log("import body:", JSON.stringify(await res.json(), null, 2).slice(0, 1200));
