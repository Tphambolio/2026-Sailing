// Deletes a photo object from Cloudflare R2 on the user's behalf.
//
// The browser can't hold the R2 secret key, so deletes are proxied through
// here (server-to-server, no presigning needed — this function just signs
// and performs the DELETE itself).
//
// JWT verification stays on (this project's default for edge functions), so
// only a signed-in app user can delete a photo.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "sailing-stop-photos";

const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const aws = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { path } = body;
  // Expected shape is "<stopKey>/<timestamp>.<ext>" — reject anything that
  // could escape the bucket via traversal or an absolute path.
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const objectUrl = `${r2Endpoint}/${R2_BUCKET}/${path}`;
  const res = await aws.fetch(objectUrl, { method: "DELETE" });

  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: `R2 delete failed: ${res.status}${detail ? `: ${detail}` : ""}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
