import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// lib/supabase.ts builds a real SupabaseClient at module load time and throws
// if the URL is empty. Stub harmless placeholder values globally so any test
// that transitively imports it (directly, or e.g. via googlePhotosPicker)
// doesn't need to know or care about Supabase config unless it's actually
// testing Supabase-specific behavior (in which case it can vi.mock it).
vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
