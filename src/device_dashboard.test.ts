import { nextHandoff } from "./device_dashboard.ts";

const update = { sellerId: "s", deviceId: "d", orderId: "o", buyerId: "b", status: "reserved" as const };
if (nextHandoff(update) !== "ready_for_handoff") {
  throw new Error("reserved devices must enter the handoff queue");
}
console.log("handoff decision: ready_for_handoff");
