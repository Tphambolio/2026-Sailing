// Read-only public front door for the sailing-stop-photos R2 bucket.
//
// The bucket's own pub-*.r2.dev URL is blocked by some phones/networks
// (r2.dev is on a lot of security blocklists), so the site serves photos
// through this Worker instead. GET/HEAD only — uploads and deletes still go
// through the Supabase edge functions. Range requests are honoured because
// iOS Safari won't play an <video> without them.

const CORS = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { ...CORS, Allow: "GET, HEAD" } });
    }

    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    // backups/ (nightly exports) and trash/ (deleted photos) are never served publicly.
    if (!key || key.includes("..") || key.startsWith("backups/") || key.startsWith("trash/")) return new Response("Not found", { status: 404, headers: CORS });

    const object = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) return new Response("Not found", { status: 404, headers: CORS });

    const headers = new Headers(CORS);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    // Paths are timestamp-named and never overwritten, so they can cache forever.
    headers.set("cache-control", "public, max-age=31536000, immutable");

    // onlyIf matched (e.g. If-None-Match): R2 returns metadata without a body.
    if (!("body" in object)) return new Response(null, { status: 304, headers });

    let status = 200;
    if (object.range && request.headers.has("range")) {
      // object.range doesn't reliably carry numbers for every form (a suffix
      // range "bytes=-N" comes back unresolved), so resolve from the header.
      const [, start, end] = request.headers.get("range").match(/bytes=(\d*)-(\d*)/) ?? [];
      const size = object.size;
      const offset = start === "" ? size - Number(end) : Number(start);
      const last = start === "" || end === "" ? size - 1 : Math.min(Number(end), size - 1);
      const length = last - offset + 1;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      status = 206;
    } else {
      headers.set("content-length", String(object.size));
    }

    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  },
};
