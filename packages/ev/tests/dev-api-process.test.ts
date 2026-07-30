import { describe, expect, it } from "vitest";
import { DevApiProcessController } from "../src/_internal/build/dev-api-process.js";

interface FakeApiProcess {
  id: string;
}

function createProcessController(events: string[]) {
  return new DevApiProcessController<FakeApiProcess>({
    expectExit(process) {
      events.push(`expect-exit:${process.id}`);
    },
    requestStop(process) {
      events.push(`request-stop:${process.id}`);
    },
    async stop(process) {
      events.push(`stop:start:${process.id}`);
      await Promise.resolve();
      events.push(`stop:end:${process.id}`);
    },
  });
}

describe("DevApiProcessController", () => {
  it("terminates and awaits a candidate that fails readiness", async () => {
    const events: string[] = [];
    const controller = createProcessController(events);
    const candidate = { id: "candidate" };

    try {
      await controller.replace(
        () => {
          events.push("start:candidate");
          return candidate;
        },
        async () => {
          events.push("ready:failed");
          throw new Error("readiness timed out");
        },
      );
    } catch (error) {
      expect(error).toEqual(new Error("readiness timed out"));
      events.push("replacement:rejected");
    }

    expect(controller.process).toBeNull();
    expect(events).toEqual([
      "start:candidate",
      "ready:failed",
      "expect-exit:candidate",
      "stop:start:candidate",
      "stop:end:candidate",
      "replacement:rejected",
    ]);
  });

  it("retains a failed candidate when cleanup fails and aggregates both errors", async () => {
    const candidate = { id: "candidate" };
    const readinessError = new Error("readiness failed");
    const cleanupError = new Error("termination failed");
    const controller = new DevApiProcessController<FakeApiProcess>({
      expectExit() {},
      requestStop() {},
      async stop() {
        throw cleanupError;
      },
    });

    const replacement = controller.replace(
      () => candidate,
      async () => {
        throw readinessError;
      },
    );

    await expect(replacement).rejects.toEqual(
      expect.objectContaining({
        cause: readinessError,
        errors: [readinessError, cleanupError],
      }),
    );
    expect(controller.process).toBe(candidate);
  });

  it("restores the previous API only after a displaced candidate stops", async () => {
    const events: string[] = [];
    const controller = createProcessController(events);
    const previous = { id: "previous" };
    const candidate = { id: "candidate" };
    const restored = { id: "restored" };

    await controller.replace(
      () => previous,
      async () => {
        events.push("ready:previous");
      },
    );
    const checkpoint = controller.checkpoint();
    await controller.replace(
      () => {
        events.push("start:candidate");
        return candidate;
      },
      async () => {
        events.push("ready:candidate");
      },
    );

    await controller.rollback(checkpoint, async () => {
      events.push("restore:previous");
      await controller.replace(
        () => restored,
        async () => {
          events.push("ready:restored");
        },
      );
    });

    expect(controller.process).toBe(restored);
    expect(events).toEqual([
      "ready:previous",
      "expect-exit:previous",
      "stop:start:previous",
      "stop:end:previous",
      "start:candidate",
      "ready:candidate",
      "expect-exit:candidate",
      "stop:start:candidate",
      "stop:end:candidate",
      "restore:previous",
      "ready:restored",
    ]);
  });

  it("restores a checkpoint after the active API is suspended for a bundle replacement", async () => {
    const events: string[] = [];
    const controller = createProcessController(events);
    const previous = { id: "previous" };
    const restored = { id: "restored" };

    await controller.replace(
      () => previous,
      async () => {
        events.push("ready:previous");
      },
    );
    const checkpoint = controller.checkpoint();
    await controller.stopForReplacement();

    expect(controller.process).toBeNull();
    await controller.rollback(checkpoint, async () => {
      events.push("restore:previous");
      await controller.replace(
        () => restored,
        async () => {
          events.push("ready:restored");
        },
      );
    });

    expect(controller.process).toBe(restored);
    expect(events).toEqual([
      "ready:previous",
      "expect-exit:previous",
      "stop:start:previous",
      "stop:end:previous",
      "restore:previous",
      "ready:restored",
    ]);
  });

  it("does not start an API during rollback when none was running", async () => {
    const events: string[] = [];
    const controller = createProcessController(events);
    const checkpoint = controller.checkpoint();

    await controller.replace(
      () => ({ id: "candidate" }),
      async () => {
        events.push("ready:candidate");
      },
    );
    await controller.rollback(checkpoint, async () => {
      events.push("restore:unexpected");
    });

    expect(controller.process).toBeNull();
    expect(events).toEqual([
      "ready:candidate",
      "expect-exit:candidate",
      "stop:start:candidate",
      "stop:end:candidate",
    ]);
  });
});
