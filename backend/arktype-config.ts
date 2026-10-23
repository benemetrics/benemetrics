// Must be imported before anything creates an ArkType schema (it is loaded
// first by backend/index.ts): undeclared keys are dropped, so spreading a
// validated body into a DAO can never carry client junk.
import { configure } from "arktype/config";

configure({ onUndeclaredKey: "delete" });
