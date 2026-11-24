import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as AnalyticsService from "./AnalyticsService.ts";
import * as NoopAnalyticsService from "./NoopAnalyticsService.ts";

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("NoopAnalyticsService", (it) => {
  it.effect("never sends telemetry requests or creates an anonymous-id file", () =>
    Effect.gen(function* () {
      const requestedUrls: Array<string> = [];
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requestedUrls.push(request.url);
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
        }),
      );
      const layerRuntime = Layer.mergeAll(
        NoopAnalyticsService.layer,
        ServerConfig.ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-noop-analytics-",
        }),
        Layer.succeed(HttpClient.HttpClient, client),
      );

      const { recorded, recordedAnonymous, anonymousIdExists } = yield* Effect.gen(function* () {
        const analytics = yield* AnalyticsService.AnalyticsService;
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;

        const recorded = yield* analytics.record("server.boot.heartbeat", {
          threadCount: 1,
          projectCount: 1,
        });
        const recordedAnonymous = yield* analytics.record(
          "test.anonymous",
          {},
          { anonymous: true },
        );
        yield* analytics.recordOwners([{ source: "connect", ownerId: "a".repeat(64) }], "server");
        yield* analytics.flush;
        const anonymousIdExists = yield* fs.exists(config.anonymousIdPath);
        return { recorded, recordedAnonymous, anonymousIdExists };
      }).pipe(Effect.provide(layerRuntime));

      assert.isFalse(recorded);
      assert.isFalse(recordedAnonymous);
      assert.isFalse(anonymousIdExists);
      assert.deepEqual(requestedUrls, []);
    }),
  );
});
