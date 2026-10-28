// Prints a fresh auth-callout issuer keypair (docs/nats.md). The seed is a
// secret — configure it as `NATS_AUTH_KEY_SEED`; the public key is the
// `issuer` of the nats-server `auth_callout` block.

import { createAccount } from "@nats-io/nkeys";

const kp = createAccount();
console.log(`issuer:      ${kp.getPublicKey()}`);
console.log(`issuer seed: ${new TextDecoder().decode(kp.getSeed())}`);
