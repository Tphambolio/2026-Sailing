// verify_jwt alone isn't enough for these functions: the site's public anon
// key is itself a valid JWT, so anyone reading the page source could call
// them. Resolve the caller to a real signed-in user and check them against
// the same editor list the RLS policies and src/data/constants.ts use.

const EDITOR_EMAILS = [
  "travisjohnkennedy@gmail.com",
  "claire.st.aubin@gmail.com",
  "vivian.st.aubin.kennedy@gmail.com",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Public key for the /auth/v1/user lookup. Prefer the one the site itself sent
// (works with both the legacy anon JWT and the new sb_publishable_ keys), then
// the platform-provided publishable key, then the legacy anon key — so this
// keeps working after the legacy JWT-based keys are disabled.
function publicKey(req: Request): string {
  const sent = req.headers.get("apikey");
  if (sent) return sent;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const first = typeof keys === "object" && keys ? Object.values(keys)[0] : undefined;
    if (typeof first === "string" && first) return first;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

/** Returns null if the caller is an editor, otherwise the status to reject with. */
export async function requireEditor(req: Request): Promise<null | { status: number; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { status: 401, error: "Not signed in" };

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: publicKey(req) },
  });
  if (!res.ok) return { status: 401, error: "Not signed in" };

  const user = await res.json().catch(() => null);
  const email = typeof user?.email === "string" ? user.email.toLowerCase() : "";
  if (!EDITOR_EMAILS.includes(email)) return { status: 403, error: "Not an editor" };

  return null;
}
