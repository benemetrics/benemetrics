{{/*
The chart name, overridable.
*/}}
{{- define "benemetrics.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
The fully qualified release name.
*/}}
{{- define "benemetrics.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "benemetrics.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "benemetrics.labels" -}}
helm.sh/chart: {{ include "benemetrics.chart" . }}
{{ include "benemetrics.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "benemetrics.selectorLabels" -}}
app.kubernetes.io/name: {{ include "benemetrics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "benemetrics.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "benemetrics.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The name of the secret that holds the sensitive configuration.
*/}}
{{- define "benemetrics.secretName" -}}
{{- printf "%s-secrets" (include "benemetrics.fullname" .) -}}
{{- end -}}

{{/*
The admin token: the explicit value, or a generated one. The generated value
is rendered into the secret and printed by the NOTES.
*/}}
{{- define "benemetrics.adminToken" -}}
{{- if .Values.adminToken -}}
{{- .Values.adminToken -}}
{{- else -}}
{{- $existing := (lookup "v1" "Secret" .Release.Namespace (include "benemetrics.secretName" .)) -}}
{{- $stored := get (default (dict) $existing.data) "admin-token" | b64dec -}}
{{- default (randAlphaNum 40) $stored -}}
{{- end -}}
{{- end -}}

{{/*
The Postgres password of the bundled instance. A generated password survives
an upgrade: it is read back from the secret, so the database never sees a
rotated credential under a running instance.
*/}}
{{- define "benemetrics.postgresPassword" -}}
{{- if .Values.database.password -}}
{{- .Values.database.password -}}
{{- else -}}
{{- $existing := (lookup "v1" "Secret" .Release.Namespace (include "benemetrics.secretName" .)) -}}
{{- $stored := get (default (dict) $existing.data) "postgres-password" | b64dec -}}
{{- default (randAlphaNum 24) $stored -}}
{{- end -}}
{{- end -}}

{{/*
The object store credentials of the bundled instance.
*/}}
{{- define "benemetrics.objectStorageAccessKeyId" -}}
{{- if .Values.objectStorage.accessKeyId -}}
{{- .Values.objectStorage.accessKeyId -}}
{{- else -}}
{{- $existing := (lookup "v1" "Secret" .Release.Namespace (include "benemetrics.secretName" .)) -}}
{{- $stored := get (default (dict) $existing.data) "object-storage-access-key-id" | b64dec -}}
{{- default "rustfsadmin" $stored -}}
{{- end -}}
{{- end -}}

{{- define "benemetrics.objectStorageSecretAccessKey" -}}
{{- if .Values.objectStorage.secretAccessKey -}}
{{- .Values.objectStorage.secretAccessKey -}}
{{- else -}}
{{- $existing := (lookup "v1" "Secret" .Release.Namespace (include "benemetrics.secretName" .)) -}}
{{- $stored := get (default (dict) $existing.data) "object-storage-secret-access-key" | b64dec -}}
{{- default "rustfsadmin" $stored -}}
{{- end -}}
{{- end -}}

{{/*
The service names of the bundled dependencies.
*/}}
{{- define "benemetrics.postgresHost" -}}
{{- if .Values.dependencies.postgres.enabled -}}
{{- printf "%s-postgres" (include "benemetrics.fullname" .) -}}
{{- else -}}
{{- fail "database.url is required when dependencies.postgres.enabled is false" -}}
{{- end -}}
{{- end -}}

{{- define "benemetrics.natsHost" -}}
{{- printf "%s-nats" (include "benemetrics.fullname" .) -}}
{{- end -}}

{{- define "benemetrics.natsPort" -}}
4222
{{- end -}}

{{- define "benemetrics.clickhouseHost" -}}
{{- if .Values.dependencies.clickhouse.enabled -}}
{{- printf "%s-clickhouse" (include "benemetrics.fullname" .) -}}
{{- else -}}
{{- required "clickhouse.host is required when dependencies.clickhouse.enabled is false" .Values.clickhouse.host -}}
{{- end -}}
{{- end -}}

{{- define "benemetrics.objectStorageEndpoint" -}}
{{- if .Values.dependencies.objectStorage.enabled -}}
{{- printf "http://%s-objectstorage:9000" (include "benemetrics.fullname" .) -}}
{{- else -}}
{{- required "objectStorage.endpoint is required when dependencies.objectStorage.enabled is false" .Values.objectStorage.endpoint -}}
{{- end -}}
{{- end -}}

{{/*
The URL the ClickHouse engine tables use to reach NATS. It is resolved from
ClickHouse's point of view, not the API pods'.
*/}}
{{- define "benemetrics.clickhouseNatsUrl" -}}
{{- if .Values.clickhouse.natsUrl -}}
{{- .Values.clickhouse.natsUrl -}}
{{- else if .Values.dependencies.nats.enabled -}}
{{- printf "%s:4222" (include "benemetrics.natsHost" .) -}}
{{- else -}}
{{- required "clickhouse.natsUrl is required when the bundled NATS is disabled" "" -}}
{{- end -}}
{{- end -}}

{{/*
The NATS servers the API and the consumer connect to.
*/}}
{{- define "benemetrics.natsServers" -}}
{{- if .Values.nats.servers -}}
{{- .Values.nats.servers -}}
{{- else if .Values.dependencies.nats.enabled -}}
{{- printf "nats://%s:4222" (include "benemetrics.natsHost" .) -}}
{{- else -}}
{{- required "nats.servers is required when dependencies.nats.enabled is false" "" -}}
{{- end -}}
{{- end -}}

{{/*
The Postgres URL of the API. The password is passed in: it is generated once
per render and shared by the secret and the bundled instance.
*/}}
{{- define "benemetrics.databaseUrl" -}}
{{- $ctx := .context -}}
{{- $password := .password -}}
{{- if $ctx.Values.database.url -}}
{{- $ctx.Values.database.url -}}
{{- else -}}
{{- $host := include "benemetrics.postgresHost" $ctx -}}
{{- $user := $ctx.Values.database.user -}}
{{- $db := $ctx.Values.database.database -}}
{{- $port := $ctx.Values.database.port -}}
{{- if $ctx.Values.database.sslMode -}}
{{- printf "postgres://%s:%s@%s:%v/%s?sslmode=%s" $user $password $host $port $db $ctx.Values.database.sslMode -}}
{{- else -}}
{{- printf "postgres://%s:%s@%s:%v/%s" $user $password $host $port $db -}}
{{- end -}}
{{- end -}}
{{- end -}}
