// Dropping undeclared keys globally is what keeps `...body` spreads in DAOs
// free of client junk; this module must load before the first schema.
import { configure } from "arktype/config";

configure({ onUndeclaredKey: "delete" });
