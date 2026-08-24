import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const requestUse = vi.fn();
const responseUse = vi.fn();

vi.mock("axios", () => ({
  default: {
    post,
    isAxiosError: (error: unknown) =>
      typeof error === "object" && error !== null && "response" in error,
    create: () => ({
      interceptors: {
        request: { use: requestUse },
        response: { use: responseUse },
      },
    }),
  },
}));

describe("refreshSession", () => {
  beforeEach(() => {
    vi.resetModules();
    post.mockReset();
    requestUse.mockReset();
    responseUse.mockReset();
    sessionStorage.clear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });

  it("stores a refreshed access token without durable storage", async () => {
    post.mockResolvedValue({ data: { access_token: "fresh" } });
    const { refreshSession, getToken } = await import("./client");

    await expect(refreshSession()).resolves.toBe("fresh");
    expect(getToken()).toBe("fresh");
    expect(localStorage.getItem("pennywise_access_token")).toBeNull();
  });

  it.each([400, 401, 403])("treats refresh %s as terminal", async (status) => {
    post.mockRejectedValue({ response: { status } });
    const expired = vi.fn();
    window.addEventListener("auth:expired", expired, { once: true });
    const { refreshSession, setToken, getToken, TerminalAuthError } =
      await import("./client");
    setToken("old");

    await expect(refreshSession()).rejects.toBeInstanceOf(TerminalAuthError);
    expect(getToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it.each([undefined, 500, 503])("preserves auth for retryable status %s", async (status) => {
    post.mockRejectedValue(status ? { response: { status } } : new Error("offline"));
    const { refreshSession, setToken, getToken, RetryableAuthError } =
      await import("./client");
    setToken("old");

    await expect(refreshSession()).rejects.toBeInstanceOf(RetryableAuthError);
    expect(getToken()).toBe("old");
  });

  it("shares one refresh within a context", async () => {
    post.mockResolvedValue({ data: { access_token: "fresh" } });
    const { refreshSession } = await import("./client");

    const [first, second] = await Promise.all([refreshSession(), refreshSession()]);
    expect(first).toBe("fresh");
    expect(second).toBe("fresh");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("serializes refresh through Web Locks when available", async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<string>) =>
      callback());
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    post.mockResolvedValue({ data: { access_token: "fresh" } });
    const { refreshSession } = await import("./client");

    await refreshSession();
    expect(request).toHaveBeenCalledWith("pennywise_refresh", expect.any(Function));
  });

  it("does not store a refresh result that completes after logout", async () => {
    let resolve!: (value: { data: { access_token: string } }) => void;
    post.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { refreshSession, invalidateSession, getToken, TerminalAuthError } =
      await import("./client");

    const pending = refreshSession();
    invalidateSession();
    resolve({ data: { access_token: "late" } });

    await expect(pending).rejects.toBeInstanceOf(TerminalAuthError);
    expect(getToken()).toBeNull();
  });
});
