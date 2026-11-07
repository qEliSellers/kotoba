export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api" + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
export const date = (n: number | null | undefined) =>
  n == null ? "Not reviewed" : new Date(n).toLocaleString();
export const days = (n: number) =>
  n < 1 ? `${(n * 24).toFixed(1)}h` : `${n.toFixed(1)}d`;
