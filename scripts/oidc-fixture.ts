/**
 * Generates the identity provider stub's key material.
 *
 * Bun reads NODE_EXTRA_CA_CERTS at process start, so the certificate the
 * suite trusts has to exist before the test process boots. The fixture is
 * reused from then on, which keeps the issuer and the published key
 * stable across runs.
 *
 *   bun scripts/oidc-fixture.ts
 */
import {
  ensureCertificate,
  ensureSigningKey,
  OIDC_CERT_PATH,
} from "../e2e/oidc-fixture";

ensureCertificate();
await ensureSigningKey();

// The suite trusts the stub's certificate; Bun reads the variable when the
// process starts, so the test script evaluates this line before running.
console.log(`export NODE_EXTRA_CA_CERTS=${OIDC_CERT_PATH}`);
