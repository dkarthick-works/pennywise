import { beforeEach, describe, expect, it, vi } from "vitest";
import client from "./client";
import { exportChits, importChits } from "./chits";

vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedGet = vi.mocked(client.get, { deep: true });
const mockedPost = vi.mocked(client.post, { deep: true });

function axiosLikeError(data: unknown): Error & { isAxiosError: boolean } {
  return Object.assign(new Error("request failed"), {
    isAxiosError: true,
    response: { data },
  });
}

describe("chit transfer API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the server filename for full and single-chit exports", async () => {
    const blob = new Blob(["{}"], { type: "application/json" });
    mockedGet.mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="pennywise-chits-2026-08-16.json"' },
    });

    await expect(exportChits()).resolves.toEqual({
      blob,
      filename: "pennywise-chits-2026-08-16.json",
    });
    expect(mockedGet).toHaveBeenCalledWith("/api/chits/export", {
      params: undefined,
      responseType: "blob",
    });

    mockedGet.mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="single.json"' },
    });
    await expect(exportChits("chit-id")).resolves.toEqual({ blob, filename: "single.json" });
    expect(mockedGet).toHaveBeenLastCalledWith("/api/chits/export", {
      params: { chit_id: "chit-id" },
      responseType: "blob",
    });
  });

  it("preserves Blob JSON export errors as causes", async () => {
    const cause = axiosLikeError(new Blob([JSON.stringify({ error: "export individual chits instead" })]));
    mockedGet.mockRejectedValue(cause);

    await expect(exportChits()).rejects.toMatchObject({
      message: "export individual chits instead",
      cause,
    });
  });

  it("posts the exact raw archive text without reserializing it", async () => {
    const raw = '{"format":"pennywise-chits","version":1,"chits":[{"chit_value":1e2,"expected_monthly":1.230}]}';
    mockedPost.mockResolvedValue({
      data: { imported_chits: 1, imported_installments: 0 },
    });

    await expect(importChits(raw)).resolves.toEqual({
      imported_chits: 1,
      imported_installments: 0,
    });
    expect(mockedPost).toHaveBeenCalledWith(
      "/api/chits/import",
      raw,
      { headers: { "Content-Type": "application/json" } },
    );
  });

  it("preserves JSON import errors as causes", async () => {
    const cause = axiosLikeError({ error: "import exceeds transfer limits" });
    mockedPost.mockRejectedValue(cause);

    await expect(importChits("{}")).rejects.toMatchObject({
      message: "import exceeds transfer limits",
      cause,
    });
  });
});
