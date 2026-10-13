# 10. DSN Creation API

Details on the DSN creation endpoints for admin use.

---

## Endpoints

### `POST /api/dsn/create`

Create a new DSN for a project. This endpoint validates the required parameters and returns a complete DSN that SDKs can use.

#### Request

```http
POST /api/dsn/create
Content-Type: application/json

{
  "projectId": "123",
  "host": "sentry.example.com",
  "publicKey": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | The project ID for the DSN |
| `host` | string | Yes | The Sentry server hostname |
| `publicKey` | string | Yes | The public key for authentication |

#### Response - Success (200)

```json
{
  "dsn": "https://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

#### Response - Error (400)

```json
{
  "error": "Missing required field: projectId"
}
```

---

### `GET /api/dsn/:projectId`

Retrieve the DSN for an existing project by project ID.

#### Request

```http
GET /api/dsn/123
```

#### Response - Success (200)

```json
{
  "dsn": "https://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

#### Response - Error (404)

```json
{
  "error": "Project not found: 999"
}
```

---

### `POST /api/dsn/generate`

Generate a new DSN with a randomly generated public key. Useful for creating test projects or when you don't need a specific public key.

#### Request

```http
POST /api/dsn/generate
Content-Type: application/json

{
  "projectId": "123",
  "host": "sentry.example.com"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | The project ID for the DSN |
| `host` | string | Yes | The Sentry server hostname |

#### Response - Success (200)

```json
{
  "dsn": "https://newkey123456789abcdef12345678@sentry.example.com/123",
  "projectId": "123",
  "publicKey": "newkey123456789abcdef12345678",
  "host": "sentry.example.com",
  "protocol": "https"
}
```

---

## SDK Integration Examples

### Using curl to get a DSN

```bash
# Create a DSN
DSN=$(curl -s -X POST http://localhost:31337/api/dsn/create \
  -H "Content-Type: application/json" \
  -d '{"projectId": "123", "host": "sentry.example.com", "publicKey": "a1b2c3d4e5f6"}' | jq -r '.dsn')

echo "Your DSN: $DSN"
```

### Environment variable setup

```bash
# Get DSN and export as environment variable
export SENTRY_DSN=$(curl -s -X POST http://localhost:31337/api/dsn/create \
  -H "Content-Type: application/json" \
  -d '{"projectId": "123", "host": "localhost:31337", "publicKey": "test-key"}')
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status Code | Meaning |
|-------------|---------|
| 200 | Success |
| 400 | Bad Request (missing/invalid parameters) |
| 404 | Not Found (project doesn't exist) |
| 500 | Internal Server Error |

---

## Security Notes

- DSNs are public by design - do not treat them as sensitive credentials
- Never commit DSNs with production public keys to version control
- Use environment-specific DSNs (dev/staging/prod) for proper event routing
- Consider rotating public keys periodically for security