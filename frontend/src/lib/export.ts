const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function monthsInRange(from: string, to: string): number {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return 0;
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

export function isValidExportRange(from: string, to: string): string | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return "From and to must be valid dates.";
  if (from > to) return "From date must be before or equal to to date.";
  if (monthsInRange(from, to) > 6) return "Date range must not exceed 6 months.";
  return null;
}

export function defaultExportRange(month: string): { from: string; to: string } {
  const [year, monthNum] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function parseContentDisposition(value?: string): string | null {
  if (!value) return null;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);

  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

// Injected by the Android WebView wrapper (android/), which can't download blob: URLs.
type AndroidBridge = { saveFile(base64: string, filename: string, mimeType: string): void };

export function downloadBlob(blob: Blob, filename: string): void {
  const android = (window as Window & { PennywiseAndroid?: AndroidBridge }).PennywiseAndroid;
  if (android) {
    const reader = new FileReader();
    reader.onload = () => {
      // Data URL is "data:<mime>;base64,<payload>".
      const base64 = String(reader.result).split(",", 2)[1] ?? "";
      android.saveFile(base64, filename, blob.type || "application/octet-stream");
    };
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
