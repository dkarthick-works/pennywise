import { beforeEach, describe, expect, it, vi } from "vitest";
import client from "./client";
import { exportLents, importLents } from "./lents";
import type { LentTransferArchive } from "../types";

vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedGet = vi.mocked(client.get, { deep: true });
const mockedPost = vi.mocked(client.post, { deep: true });

const archive: LentTransferArchive = {
  type: "pennywise-lents",
  version: 1,
  exported_at: "2026-08-16T00:00:00Z",
  lents: [],
};

function axiosLikeError(data: unknown): Error & { isAxiosError: boolean } {
  return Object.assign(new Error("request failed"), {
    isAxiosError: true,
    response: { data },
  });
}

describe("lent transfer API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the server filename for JSON exports", async () => {
    const blob = new Blob(["{}"], { type: "application/json" });
    mockedGet.mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="backup.json"' },
    });

    await expect(exportLents()).resolves.toEqual({ blob, filename: "backup.json" });
  });

  it("preserves Blob JSON export errors as causes", async () => {
    const cause = axiosLikeError(new Blob([JSON.stringify({ error: "archive too large" })]));
    mockedGet.mockRejectedValue(cause);

    await expect(exportLents()).rejects.toMatchObject({
      message: "archive too large",
      cause,
    });
  });

  it("returns import counts", async () => {
    mockedPost.mockResolvedValue({
      data: { imported_lents: 2, imported_repayments: 3 },
    });

    await expect(importLents(archive)).resolves.toEqual({
      imported_lents: 2,
      imported_repayments: 3,
    });
    expect(mockedPost).toHaveBeenCalledWith("/api/lents/import", archive);
  });

  it("preserves JSON import errors as causes", async () => {
    const cause = axiosLikeError({ error: "invalid archive" });
    mockedPost.mockRejectedValue(cause);

    await expect(importLents(archive)).rejects.toMatchObject({
      message: "invalid archive",
      cause,
    });
  });
});
