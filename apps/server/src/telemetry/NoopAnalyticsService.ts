import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AnalyticsService from "./AnalyticsService.ts";

// Fork override wired at the server composition boundary so upstream AnalyticsService stays conflict-free.
export const layer = Layer.succeed(
  AnalyticsService.AnalyticsService,
  AnalyticsService.AnalyticsService.of({
    record: Effect.fn("AnalyticsService.record")(() => Effect.succeed(false)),
    flush: Effect.void,
    recordOwners: Effect.fn("AnalyticsService.recordOwners")(() => Effect.void),
  }),
);
