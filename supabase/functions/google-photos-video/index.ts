// Google Photos Picker video download relay.
//
// Google's Photos Picker API lets a browser fetch photo bytes directly
// cross-origin (the =w/=d baseUrl suffixes), but the video suffix (=dv)
// doesn't send permissive CORS headers — a browser fetch() to it fails with
// an opaque "Failed to fetch", live-confirmed against several videos
// including ones fully processed and days old, so this isn't a timing issue.
// Server-to-server has no CORS to enforce, so this function does the fetch
// on Google's behalf and streams the bytes back to the browser.
//
// JWT verification stays on (this project's default for edge functions), so
// only a signed-in app user can call this — not an open relay. The Google
// OAuth token passed in is short-lived (~1hr) and scoped read-only to the
// user's own picker selection, so relaying it here doesn't grant anything
// the caller couldn't already do directly.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: { baseUrl?: unknown; googleToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { baseUrl, googleToken } = body;
  if (typeof baseUrl !== "string" || typeof googleToken !== "string") {
    return new Response(JSON.stringify({ error: "baseUrl and googleToken are required strings" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only ever proxy Google's own media CDN, never an arbitrary caller-supplied
  // host — keeps this from being usable as a general-purpose open relay.
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid baseUrl" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!parsed.hostname.endsWith(".googleusercontent.com") || parsed.protocol !== "https:") {
    return new Response(JSON.stringify({ error: "baseUrl must be an https googleusercontent.com URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let googleRes: Response;
  try {
    googleRes = await fetch(`${baseUrl}=dv`, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Fetching from Google failed: ${String(err)}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!googleRes.ok || !googleRes.body) {
    const detail = await googleRes.text().catch(() => "");
    return new Response(JSON.stringify({ error: `Google returned ${googleRes.status}${detail ? `: ${detail}` : ""}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(googleRes.body, {
    headers: {
      ...corsHeaders,
      "Content-Type": googleRes.headers.get("Content-Type") || "video/mp4",
    },
  });
});
