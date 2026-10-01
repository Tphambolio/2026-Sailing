// Mints a short-lived presigned PUT URL for Cloudflare R2.
//
// Photos live in R2, not Supabase Storage, to avoid Supabase's egress billing
// (R2 has zero egress fees). The browser can't hold the R2 secret key, so it
// asks this function for a presigned URL and then PUTs the file bytes
// directly to R2 — the file never passes through Supabase, so this doesn't
// count against Supabase's egress/storage quotas either.
//
// JWT verification stays on (this project's default for edge functions), so
// only a signed-in app user can request an upload URL.

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
const R2_PUBLIC_URL = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/$/, "");

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

  let body: { stopKey?: unknown; filename?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { stopKey, filename } = body;
  if (typeof stopKey !== "string" || typeof filename !== "string" || !stopKey || !filename) {
    return new Response(JSON.stringify({ error: "stopKey and filename are required strings" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // stopKey/filename only ever form a storage path here — reject anything
  // that could escape that path (traversal, extra segments).
  if (/[\/\\]|\.\./.test(stopKey) || /[\/\\]|\.\./.test(filename)) {
    return new Response(JSON.stringify({ error: "Invalid stopKey or filename" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  const path = `${stopKey}/${Date.now()}.${ext}`;

  const objectUrl = new URL(`${r2Endpoint}/${R2_BUCKET}/${path}`);
  objectUrl.searchParams.set("X-Amz-Expires", "300"); // 5 minutes — just long enough for one upload

  const signed = await aws.sign(objectUrl.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });

  return new Response(
    JSON.stringify({
      path,
      uploadUrl: signed.url,
      publicUrl: `${R2_PUBLIC_URL}/${path}`,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
