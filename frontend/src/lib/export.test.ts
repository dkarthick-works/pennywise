import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { downloadBlob } from "./export";

type TestWindow = Window & { PennywiseAndroid?: { saveFile: ReturnType<typeof vi.fn> } };

describe("downloadBlob — Android WebView bridge", () => {
  afterEach(() => {
    delete (window as TestWindow).PennywiseAndroid;
  });

  it("hands the file to the bridge as base64 with its name and type", async () => {
    const saveFile = vi.fn();
    (window as TestWindow).PennywiseAndroid = { saveFile };

    downloadBlob(new Blob(["date,amount\n2026-10-01,250"], { type: "text/csv" }), "export.csv");

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const [base64, filename, mimeType] = saveFile.mock.calls[0];
    expect(atob(base64)).toBe("date,amount\n2026-10-01,250");
    expect(filename).toBe("export.csv");
    expect(mimeType).toBe("text/csv");
  });
});
