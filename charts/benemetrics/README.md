# Benemetrics Helm chart

Installs the Benemetrics API, the side-effects consumer and — unless you point
them at managed services — PostgreSQL, ClickHouse, NATS JetStream and an
S3-compatible object store.

```bash
helm install benemetrics charts/benemetrics \
  --namespace benemetrics --create-namespace \
  --set image.repository=git.valerio.pw/benemetrics/app \
  --set image.tag=0.1.0 \
  --set adminToken="$(openssl rand -hex 24)"
```

See the [project README](../../README.md#deploy-on-kubernetes) for the full
walkthrough.

## What it installs

| Resource | Name | Notes |
|---|---|---|
| Deployment | `<release>-backend` | The API and the UI, behind the Ingress |
| Deployment | `<release>-consumer` | The side-effects consumer (issues, alerts, releases) |
| Service | `<release>-backend` | The API |
| Ingress | `<release>` | The UI (`/ui`) and the API |
| Secret | `<release>-secrets` | The admin token, the database URL, the object store credentials |
| ServiceAccount | `<release>` | `automountServiceAccountToken: false` |
| StatefulSet | `<release>-postgres` | The control plane database |
| StatefulSet | `<release>-clickhouse` | The event store |
| StatefulSet | `<release>-nats` | JetStream + the WebSocket listener |
| StatefulSet | `<release>-objectstorage` | RustFS, the S3-compatible store |
| Job (hook) | `<release>-bucket-init` | Creates the replay bucket and its CORS rule |
| Pod (hook) | `<release>-test-connection` | `helm test` |

## Values

### Image and credentials

| Key | Default | Description |
|---|---|---|
| `image.repository` | `git.valerio.pw/benemetrics/app` | The image built from the Dockerfile |
| `image.tag` | `""` | Defaults to the chart `appVersion` |
| `image.pullPolicy` | `IfNotPresent` | |
| `imagePullSecrets` | `[]` | |
| `adminToken` | generated | The master credential (`API-Key <token>`) |
| `oidc.issuer` | `""` | An OIDC provider (optional) |
| `oidc.clientId` | `""` | |
| `oidc.clientSecret` | `""` | |
| `oidc.scopes` | `openid profile email` | |
| `oidc.audience` | `""` | |

### The API

| Key | Default | Description |
|---|---|---|
| `backend.replicaCount` | `2` | |
| `backend.port` | `31337` | The container port |
| `backend.service.type` | `ClusterIP` | |
| `backend.service.port` | `80` | |
| `backend.resources` | 100m / 256Mi | Requests and limits |
| `backend.probes.*.enabled` | `true` | The API has no health endpoint: the root redirect is the signal |
| `backend.autoscaling.enabled` | `false` | HPA |
| `backend.autoscaling.minReplicas` / `maxReplicas` | `2` / `6` | |
| `backend.autoscaling.targetCPUUtilizationPercentage` | `75` | |
| `backend.podDisruptionBudget.enabled` | `false` | |
| `backend.podDisruptionBudget.minAvailable` | `1` | |
| `backend.extraEnv` | `[]` | Extra environment variables |
| `backend.nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | |

### The side-effects consumer

| Key | Default | Description |
|---|---|---|
| `consumer.enabled` | `true` | The durable pull consumer owns the events; keep it a singleton |
| `consumer.replicaCount` | `1` | |
| `consumer.resources` | 50m / 128Mi | |
| `consumer.extraEnv` | `[]` | |

### Ingress

| Key | Default | Description |
|---|---|---|
| `ingress.enabled` | `true` | |
| `ingress.className` | `""` | |
| `ingress.annotations` | `{}` | |
| `ingress.hosts` | `benemetrics.local` | The hosts and their paths |
| `ingress.tls` | `[]` | |

### The bundled services

| Key | Default | Description |
|---|---|---|
| `dependencies.postgres.enabled` | `true` | Turn it off and set `database.url` |
| `dependencies.postgres.persistence.size` | `8Gi` | |
| `dependencies.clickhouse.enabled` | `true` | Turn it off and set `clickhouse.host` |
| `dependencies.clickhouse.persistence.size` | `20Gi` | |
| `dependencies.nats.enabled` | `true` | Turn it off and set `nats.servers` |
| `dependencies.nats.persistence.size` | `4Gi` | |
| `dependencies.nats.websocket.service.type` | `ClusterIP` | The live feed listener; use `LoadBalancer` or `NodePort` to publish it |
| `dependencies.objectStorage.enabled` | `true` | Turn it off and set `objectStorage.endpoint` |
| `dependencies.objectStorage.persistence.size` | `10Gi` | |
| `dependencies.objectStorage.bucket.create` | `true` | The bucket and its CORS rule are created by a hook |

### External services

| Key | Default | Description |
|---|---|---|
| `database.url` | `""` | The full PostgreSQL URL |
| `database.sslMode` | `""` | Appended to the generated URL |
| `clickhouse.host` / `.port` / `.database` / `.user` / `.password` | | |
| `clickhouse.natsUrl` | | Where **ClickHouse** reaches NATS |
| `nats.servers` | `""` | The API's NATS URL |
| `nats.streamMaxBytes` | `1 GiB` | The JetStream stream bound |
| `objectStorage.endpoint` / `.bucket` / `.region` | | |
| `objectStorage.accessKeyId` / `.secretAccessKey` | `rustfsadmin` | The bundled store's credentials |

### Runtime

| Key | Default | Description |
|---|---|---|
| `config.alertEvaluationIntervalMs` | `60000` | The threshold-rule sweeper |
| `config.initRetryAttempts` / `initRetryDelayMs` | `5` / `1000` | The boot retries |
| `serviceAccount.create` / `.name` / `.annotations` | `true` | |
| `serviceAccount.automountServiceAccountToken` | `false` | |
