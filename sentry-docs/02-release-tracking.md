# 2. Release Tracking — Platform Agnostic

Track deployments, catch regressions, and link errors to exact commits.

## Why Release Tracking Matters

| Without Releases | With Releases |
|------------------|---------------|
| "Errors increased" | "Errors increased in v2.3.1" |
| Manual git bisect | "Suspect commit: abc123 - fix: payment validation" |
| Unknown deploy impact | "Regression: v2.3.0 fixed, v2.3.1 broke" |

## Setup Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  CI/CD      │────▶│  sentry-cli  │────▶│  Sentry     │
│  (GitHub    │     │  releases    │     │  UI         │
│   Actions)  │     │  new/finalize│     │             │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              set-commits    deploys new
              --auto         -e production
```

## Installation

```bash
# Install sentry-cli (works on all platforms)
# macOS
brew install sentry-cli

# Linux
curl -sL https://sentry.io/get-cli/ | bash

# Windows (PowerShell)
iwr -useb https://sentry.io/get-cli/ | iex

# Or via npm (Node.js projects)
npm install -g @sentry/cli

# Or via pip (Python projects)
pip install sentry-cli

# Verify
sentry-cli --version
```

## Configuration

### 1. Sentry Auth Token

```bash
# Create at: https://sentry.io/settings/account/api/auth-tokens/
# Scopes: project:releases, project:write, org:read
export SENTRY_AUTH_TOKEN="sntrys_..."
export SENTRY_ORG="your-org"
export SENTRY_PROJECT="your-project"
```

### 2. Release Version Strategy

Choose a version format that works for your project:

```bash
# Option 1: Git tag (recommended)
git describe --tags --always --dirty
# Output: v2.3.1-5-gabc1234

# Option 2: Semver from package.json / pyproject.toml / Cargo.toml / pom.xml + git sha
# Node.js: npm version patch && git rev-parse --short HEAD
# Python: poetry version && git rev-parse --short HEAD
# Go: git describe --tags --always --dirty
# Java: mvn help:evaluate -Dexpression=project.version && git rev-parse --short HEAD
# .NET: dotnet --version && git rev-parse --short HEAD

# Option 3: CI-provided version
# GitHub Actions: ${GITHUB_REF_NAME#v}
# GitLab CI: $CI_COMMIT_TAG
# CircleCI: $CIRCLE_TAG
# Jenkins: $BUILD_NUMBER
```

## CI/CD Integration

### GitHub Actions (Complete Workflow)

```yaml
# .github/workflows/sentry-release.yml
name: Sentry Release

on:
  push:
    tags: ["v*"]  # Trigger on version tags
  workflow_dispatch:  # Manual trigger

permissions:
  contents: read
  # For private repos, add: id-token: write

jobs:
  sentry-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for commit history
      
      - name: Install sentry-cli
        run: |
          curl -sL https://sentry.io/get-cli/ | bash
      
      - name: Create Release
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          sentry-cli releases new -p $SENTRY_PROJECT $VERSION
      
      - name: Associate Commits
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
        run: |
          sentry-cli releases set-commits $VERSION --auto
      
      - name: Finalize Release
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
        run: |
          sentry-cli releases finalize $VERSION
      
      - name: Create Deploy
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
        run: |
          sentry-cli releases deploys $VERSION new -e production
```

### GitLab CI

```yaml
# .gitlab-ci.yml
sentry_release:
  stage: deploy
  image: curlimages/curl:latest
  script:
    - curl -sL https://sentry.io/get-cli/ | bash
    - VERSION=${CI_COMMIT_TAG#v}
    - sentry-cli releases new -p $SENTRY_PROJECT $VERSION
    - sentry-cli releases set-commits $VERSION --auto
    - sentry-cli releases finalize $VERSION
    - sentry-cli releases deploys $VERSION new -e production
  only:
    - tags
  variables:
    SENTRY_AUTH_TOKEN: $SENTRY_AUTH_TOKEN
    SENTRY_ORG: $SENTRY_ORG
    SENTRY_PROJECT: $SENTRY_PROJECT
```

### Generic CI Script (Works Anywhere)

```bash
#!/bin/bash
# scripts/sentry-release.sh

set -euo pipefail

VERSION="${1:-$(git describe --tags --always --dirty)}"
ENVIRONMENT="${2:-production}"

echo "Creating Sentry release: $VERSION"

sentry-cli releases new -p "$SENTRY_PROJECT" "$VERSION"
sentry-cli releases set-commits "$VERSION" --auto
sentry-cli releases finalize "$VERSION"
sentry-cli releases deploys "$VERSION" new -e "$ENVIRONMENT"

echo "Release $VERSION deployed to $ENVIRONMENT"
```

Usage:
```bash
# In CI
./scripts/sentry-release.sh v2.3.1 production

# Local testing
SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... \
  ./scripts/sentry-release.sh dev-$(git rev-parse --short HEAD) development
```

## Setting Release at Runtime (All Platforms)

### TypeScript / Node.js / Bun / Deno

```typescript
// sentry.config.ts
import * as Sentry from "@sentry/node";
import { readFileSync } from "fs";
import { execSync } from "child_process";

export function getRelease(): string {
  // Priority: env var > package.json + git sha > default
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    return `${pkg.version}-${sha}`;
  } catch {
    return "1.0.0-dev";
  }
}

export function initSentry(options: { dsn: string }) {
  Sentry.init({
    dsn: options.dsn,
    release: getRelease(),
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    // ...
  });
}
```

### Python

```python
# sentry_config.py
import sentry_sdk
import os
import subprocess
import json

def get_release():
    # Priority: env var > pyproject.toml + git sha > default
    if os.getenv("SENTRY_RELEASE"):
        return os.getenv("SENTRY_RELEASE")
    
    try:
        # Read version from pyproject.toml or setup.py
        import toml
        with open("pyproject.toml") as f:
            data = toml.load(f)
        version = data.get("tool", {}).get("poetry", {}).get("version", "1.0.0")
        
        sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
        return f"{version}-{sha}"
    except Exception:
        return "1.0.0-dev"

def init_sentry(dsn: str):
    sentry_sdk.init(
        dsn=dsn,
        release=get_release(),
        environment=os.getenv("SENTRY_ENVIRONMENT", "development"),
    )
```

### Go

```go
// sentry_config.go
package main

import (
    "os"
    "os/exec"
    "strings"
    "github.com/getsentry/sentry-go"
)

func getRelease() string {
    if v := os.Getenv("SENTRY_RELEASE"); v != "" {
        return v
    }
    
    // Try to get version from go.mod or VERSION file
    version := "1.0.0"
    if data, err := os.ReadFile("VERSION"); err == nil {
        version = strings.TrimSpace(string(data))
    }
    
    sha := "unknown"
    if out, err := exec.Command("git", "rev-parse", "--short", "HEAD").Output(); err == nil {
        sha = strings.TrimSpace(string(out))
    }
    
    return version + "-" + sha
}

func InitSentry(dsn string) {
    sentry.Init(sentry.ClientOptions{
        Dsn: dsn,
        Release: getRelease(),
        Environment: getEnv("SENTRY_ENVIRONMENT", "development"),
    })
}
```

### Java

```java
// SentryConfig.java
import io.sentry.Sentry;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class SentryConfig {
    public static void init(String dsn) {
        String release = getRelease();
        String environment = System.getenv("SENTRY_ENVIRONMENT");
        
        Sentry.init(options -> {
            options.setDsn(dsn);
            options.setRelease(release);
            options.setEnvironment(environment != null ? environment : "development");
        });
    }
    
    private static String getRelease() {
        String envRelease = System.getenv("SENTRY_RELEASE");
        if (envRelease != null) return envRelease;
        
        try {
            // Read version from pom.xml or build.gradle
            String version = "1.0.0";
            // ... parse version from build file
            
            Process p = Runtime.getRuntime().exec(new String[]{"git", "rev-parse", "--short", "HEAD"});
            BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String sha = reader.readLine();
            return version + "-" + (sha != null ? sha : "unknown");
        } catch (Exception e) {
            return "1.0.0-dev";
        }
    }
}
```

### .NET

```csharp
// SentryConfig.cs
using Sentry;
using System.Diagnostics;

public class SentryConfig {
    public static void Init(string dsn) {
        var release = GetRelease();
        var environment = Environment.GetEnvironmentVariable("SENTRY_ENVIRONMENT") ?? "development";
        
        SentrySdk.Init(o => {
            o.Dsn = dsn;
            o.Release = release;
            o.Environment = environment;
        });
    }
    
    private static string GetRelease() {
        var envRelease = Environment.GetEnvironmentVariable("SENTRY_RELEASE");
        if (!string.IsNullOrEmpty(envRelease)) return envRelease;
        
        try {
            var version = "1.0.0"; // Read from .csproj or Directory.Build.props
            var sha = RunCommand("git", "rev-parse --short HEAD");
            return $"{version}-{sha}";
        } catch {
            return "1.0.0-dev";
        }
    }
    
    private static string RunCommand(string cmd, string args) {
        var process = Process.Start(new ProcessStartInfo(cmd, args) {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        process.WaitForExit();
        return process.StandardOutput.ReadToEnd().Trim();
    }
}
```

## Source Maps / Debug Symbols Upload (Critical for Stack Traces)

### JavaScript/TypeScript (Vite, Webpack, Next.js, Remix, etc.)

```bash
# Vite
npm install -D @sentry/vite-plugin

# vite.config.ts
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  plugins: [
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  build: { sourcemap: true },
});
```

```bash
# Webpack
npm install -D @sentry/webpack-plugin

# webpack.config.js
const SentryWebpackPlugin = require("@sentry/webpack-plugin");

module.exports = {
  plugins: [
    new SentryWebpackPlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  devtool: "source-map",
};
```

```bash
# Next.js
npm install -D @sentry/nextjs

# next.config.js
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(
  { /* your next config */ },
  { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN }
);
```

### Python (Source Maps Not Applicable)

Python doesn't use source maps. Ensure debug symbols are available:

```bash
# For C extensions, compile with debug symbols
pip install --no-binary :all: your-package
```

### Go (Debug Symbols)

```bash
# Build with debug info
go build -gcflags="all=-N -l" -o myapp .

# Or use delve for debugging
go install github.com/go-delve/delve/cmd/dlv@latest
```

### Java (Source Maps Not Applicable)

Java uses stack traces directly. Ensure line numbers in compiled classes:

```xml
<!-- Maven: ensure debug info -->
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <debug>true</debug>
    <debuglevel>lines,vars,source</debuglevel>
  </configuration>
</plugin>
```

### .NET (PDB Files)

```bash
# Build with debug symbols (default in Debug)
dotnet build -c Debug

# For Release with symbols
dotnet build -c Release -p:DebugType=portable -p:DebugSymbols=true
```

### Manual Upload (Any Platform)

```bash
# Upload all debug files from dist/
sentry-cli debug-files upload --org $SENTRY_ORG --project $SENTRY_PROJECT dist/

# Or for JavaScript source maps specifically
sentry-cli sourcemaps inject --org $SENTRY_ORG --project $SENTRY_PROJECT dist/
sentry-cli sourcemaps upload --org $SENTRY_ORG --project $SENTRY_PROJECT dist/
```

## Verifying in Sentry UI

### Release Page
- **Issues** tab: "New in this release", "Regressed in this release"
- **Commits** tab: Linked commits with authors
- **Deploys** tab: Environment, time, duration

### Issue View
```
┌─────────────────────────────────────────────┐
│ Issue: TypeError: Cannot read 'id' of null  │
├─────────────────────────────────────────────┤
│ 🏷️  New in v2.3.1                          │
│ 📦  Releases: v2.3.1 (12), v2.3.0 (0)      │
│ 🔍  Suspect commits:                        │
│    • abc123 - feat: add user validation     │
│    • def456 - refactor: user service        │
└─────────────────────────────────────────────┘
```

## Advanced: Release Health

Track adoption and crash-free sessions:

```typescript
// TypeScript
Sentry.init({
  release: getRelease(),
  autoSessionTracking: true,
  sessionTrackingIntervalMillis: 30000,
});
```

```python
# Python
sentry_sdk.init(
    release=get_release(),
    auto_session_tracking=True,
)
```

```go
// Go
sentry.Init(sentry.ClientOptions{
    Release: getRelease(),
    AutoSessionTracking: true,
})
```

View in Sentry: **Releases → Release Health** → Crash-free sessions %, adoption.

## Rollback Detection

```bash
# If you rollback, create a new deploy for the old version
sentry-cli releases deploys v2.3.0 new -e production -n "rollback from v2.3.1"
```

## Monorepo Support

```bash
# Each package/project gets its own release
sentry-cli releases new -p frontend v2.3.1
sentry-cli releases new -p api v2.3.1
sentry-cli releases new -p worker v2.3.1

# Or use a shared release name across projects
sentry-cli releases new v2.3.1 --project frontend --project api --project worker
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Release not found" | Ensure `sentry-cli releases finalize` ran |
| No suspect commits | Run `set-commits --auto` after `releases new` |
| Source maps not working | Verify `sourcemap: true` in build, upload .map files |
| Wrong release in UI | Check `release` option in `Sentry.init()` matches CI |
| Commits not linking | Ensure repo connected in Sentry: Settings → Integrations → GitHub/GitLab |

## Quick Reference

```bash
# Create release
sentry-cli releases new -p $PROJECT $VERSION

# Link commits (auto-detect from git)
sentry-cli releases set-commits $VERSION --auto

# Link commits (manual)
sentry-cli releases set-commits $VERSION --commit "owner/repo@sha"

# Finalize (required for issue linking)
sentry-cli releases finalize $VERSION

# Create deploy
sentry-cli releases deploys $VERSION new -e production

# List releases
sentry-cli releases list -p $PROJECT

# Delete release
sentry-cli releases delete $VERSION -p $PROJECT
```

## Next: [Performance Monitoring →](./03-performance-monitoring.md)