/**
 * The test environment: the settings the suite needs before any backend
 * module is loaded (the backend reads them at import time).
 *
 * The suite gets its own side-effects and flags consumers: a deployment
 * that runs against the same NATS would otherwise split the messages with
 * the suite, and the side effects would land in the other database.
 */
process.env.NATS_SIDE_EFFECTS_CONSUMER ??= "side-effects-test";
process.env.NATS_FLAGS_CONSUMER ??= "flags-consumer-test";
