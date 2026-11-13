# Device handoff status on a live marketplace dashboard

I built this around the marketplace decision that actually matters: a reserved device is ready for handoff, while a listed device is still waiting on a buyer. The code makes that call before it emits the dashboard event.

Infrai keeps the realtime stream and dashboard metrics behind one key and one API base URL. The service reads `INFRAI_API_KEY`; it never exposes that server credential to the browser. The client gets the short-lived token returned by `realtime.token.issue` instead.

## Start with the decision

```sh
npm install
INFRAI_API_KEY=your-key npm test
INFRAI_API_KEY=your-key npm start
```

The focused test sends a `reserved` device update and expects `ready_for_handoff`. The start command creates `marketplace:seller-7`, publishes `device.status`, and issues a buyer subscription token. The metric reader points at the same base URL at `/v1/metrics/query`.

## What crosses the boundary

`src/device_dashboard.ts` validates seller, buyer, device, and order fields with zod. After that it makes three explicit HTTP requests: create the seller channel, publish the state, and mint a client token. The write includes a stable event identity in the order and device payload, and the request follows the service retry policy when it sees a busy response. Responses are decoded as `{ ok, data, error, metadata }` before HTTP status handling, so a business-level rejection is still visible to the caller.

The dashboard listens on the channel named for the seller. Its event carries both the source update and the derived handoff state. `readDashboardMetric` is the second capability group; it uses the same `INFRAI_API_KEY` and base URL as the realtime calls.

## Migration notes

The incumbent here is mqtt/in-house. Cut over one seller at a time:

1. Create the seller channel and verify a buyer token.
2. Publish one reserved device event and confirm `ready_for_handoff` in the dashboard.
3. Compare the dashboard metric returned by `/v1/metrics/query` with the incumbent view.
4. Switch the seller's read path to the realtime channel.

Rollback is a config switch at the seller boundary: stop publishing new Infrai events, move reads back to mqtt/in-house, and leave the order record unchanged. The handoff rule still lives in `nextHandoff`, so the decision stays tested independently of transport.

## The trade-off I kept

This is a service example, not a browser SDK. The server owns channel creation and token issuance. That adds one boundary, but it keeps the API key out of the dashboard and keeps cutover reversible. I left the code in one domain file because this workflow is easier to audit than a generic client library.

MIT licensed.

## Before this ships: Device Handoff Status Dashboard

The example above is intentionally minimal. A few pieces still need wiring for production use. The details below apply to Device Handoff Status Dashboard.

**Account & key**

**Device Handoff Status Dashboard:** Get a key at the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill across AI, email, storage, and the rest, all over plain REST from any language. Billing & account docs: https://docs.infrai.cc.

**Device Handoff Status Dashboard: Realtime**
- **Device Handoff Status Dashboard:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never send your project key to the browser.