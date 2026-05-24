# Live Sync Peer Discovery

Myelin can use a small Cloudflare Worker as a rendezvous service for live sync.
The service does not relay note contents. It stores short-lived Iroh endpoint
tickets so two devices that open the same remote-backed note can find each other
without copying a manual code.

## Runtime Flow

1. The app derives a room id from the repository identity and note id.
2. When a note opens, the app hosts an Iroh gossip topic and publishes its
   endpoint ticket to the room.
3. The Worker stores the record in a Durable Object for that room and returns
   the current fresh records.
4. The app joins one of the returned peer tickets. Yjs updates then flow
   directly over Iroh.
5. While the note stays open, the app refreshes its record shortly before the
   TTL expires.
6. When the note closes normally, the app deletes its record. If a record is
   left behind, the Worker deletes it after its TTL.

Local-only repositories do not participate because there is no shared repository
identity for multiple devices to derive the same room.

## Cloudflare Setup

1. Install or use Wrangler:

   ```bash
   yarn global add wrangler
   wrangler login
   ```

2. Deploy the Worker:

   ```bash
   cd workers/live-discovery
   wrangler deploy
   ```

3. Copy the deployed Worker URL and add it to the app environment:

   ```bash
   VITE_LIVE_DISCOVERY_URL=https://myelin-live-discovery.<your-subdomain>.workers.dev
   ```

4. Restart the Myelin dev server or rebuild the app so Vite embeds the URL.

The Worker uses the Workers Free plan plus a SQLite-backed Durable Object. If
the free limits are exceeded, Cloudflare rejects excess operations rather than
silently charging a bill.
