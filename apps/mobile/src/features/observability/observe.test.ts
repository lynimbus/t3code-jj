import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { configure, dispatchEvents, reportError } = vi.hoisted(() => ({
  configure: vi.fn(),
  dispatchEvents: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {
        relay: { url: "https://relay.example.test" },
        appVariant: "production",
      },
    },
  },
}));

vi.mock("expo-observe", () => ({
  Observe: {
    configure,
    dispatchEvents,
    reportError,
  },
}));

describe("observe", () => {
  beforeEach(() => {
    vi.resetModules();
    configure.mockClear();
    dispatchEvents.mockClear();
    reportError.mockClear();
  });

  it("disables crash reporting on load and never enables dispatching", async () => {
    vi.stubGlobal("__DEV__", false);
    try {
      const observe = await import("./observe");

      expect(observe.crashReportingAvailable).toBe(false);
      expect(configure).toHaveBeenCalledWith({
        dispatchingEnabled: false,
        environment: "production",
      });

      await observe.setCrashReportsEnabled(true);

      expect(dispatchEvents).not.toHaveBeenCalled();
      expect(configure).toHaveBeenLastCalledWith({
        dispatchingEnabled: false,
        environment: "production",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
