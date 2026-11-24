import { assert, it, vi } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/http";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { allowedFor, layerHeadlessRelayClient, layerServerRelayBroker } from "./relayTracing.ts";

it.effect("exported server and CLI relay tracing layers never install a tracer or fetch", () =>
  Effect.gen(function* () {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const deps = Layer.mergeAll(
      ManagedPolicy.layerTest({
        schemaVersion: 1,
        organization: "Example Corp",
        limits: { telemetry: true },
      }),
      Layer.succeed(HostProcess.Environment, { T3CODE_TELEMETRY_ENABLED: "true" }),
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    );

    const checkLayer = (layer: typeof layerServerRelayBroker) =>
      Effect.service(RelayTracing.RelayClientTracer).pipe(
        Effect.tap(() =>
          Effect.void.pipe(Effect.withSpan("relay.test"), RelayTracing.withRelayClientTracing),
        ),
        Effect.provide(layer.pipe(Layer.provide(deps))),
      );

    assert.isTrue(Option.isNone(yield* checkLayer(layerServerRelayBroker)));
    assert.isTrue(Option.isNone(yield* checkLayer(layerHeadlessRelayClient)));
    assert.isFalse(allowedFor({ T3CODE_TELEMETRY_ENABLED: "true" }, undefined));
    assert.strictEqual(fetchFn.mock.calls.length, 0);
  }),
);
