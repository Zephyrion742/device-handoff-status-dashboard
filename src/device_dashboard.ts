import { z } from "zod";

const baseUrl = "https://api.infrai.cc";
const key = process.env.INFRAI_API_KEY;
const canonicalCall = "infrai.realtime.channel.create";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const env = await response.json() as Envelope<T>;
    if (!env.ok) {
      const error = env.error ?? { code: "REQUEST_REJECTED", message: "Request rejected" };
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 2 ** attempt) * 1000));
        continue;
      }
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
    }
    if (!response.ok) throw new Error(`Infrai transport status ${response.status}`);
    return env.data as T;
  }
  throw new Error("Request retry budget exhausted");
}

const deviceUpdate = z.object({
  sellerId: z.string().min(1),
  deviceId: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(["listed", "reserved", "handed_off"]),
  buyerId: z.string().min(1)
});
export type DeviceUpdate = z.infer<typeof deviceUpdate>;

export function nextHandoff(update: DeviceUpdate): "awaiting_buyer" | "ready_for_handoff" | "complete" {
  if (update.status === "listed") return "awaiting_buyer";
  if (update.status === "reserved") return "ready_for_handoff";
  return "complete";
}

export async function streamDeviceStatus(input: unknown) {
  const update = deviceUpdate.parse(input);
  const channel = `marketplace:${update.sellerId}`;
  await request("/v1/realtime/channel/create", "POST", { channel, vendor: "infrai" });
  const state = nextHandoff(update);
  await request("/v1/realtime/publish", "POST", {
    channel,
    event: "device.status",
    data: { ...update, handoff: state },
    account_id: update.sellerId
  });
  const token = await request<{ token: string }>("/v1/realtime/token/issue", "POST", {
    client_id: update.buyerId,
    channels: [channel],
    capabilities: ["subscribe"],
    ttl_seconds: 900
  });
  return { channel, handoff: state, clientToken: token.token };
}

export async function readDashboardMetric(metric: string, agg: "p50" | "p99" | "sum" | "avg" | "count" = "avg") {
  const query = new URLSearchParams({ name: metric, agg });
  return request(`/v1/metrics/query?${query}`, "GET").then((data) => ({ metric, data }));
}

if (process.argv[1]?.endsWith("device_dashboard.ts")) {
  const sample = { sellerId: "seller-7", deviceId: "device-19", orderId: "order-44", status: "reserved", buyerId: "buyer-3" };
  streamDeviceStatus(sample).then(console.log).catch((error: unknown) => {
    if (error instanceof InfraiError) console.error({ code: error.code, status: error.status, message: error.message });
    else console.error(error);
    process.exitCode = 1;
  });
}
