import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

async function fetchEntryKeys(): Promise<Set<string>> {
  const [notesRes, photosRes] = await Promise.all([
    supabase.from('sailing_stop_notes').select('stop_key').neq('content', ''),
    supabase.from('sailing_stop_photos').select('stop_key'),
  ]);
  const next = new Set<string>();
  (notesRes.data ?? []).forEach(r => next.add(r.stop_key));
  (photosRes.data ?? []).forEach(r => next.add(r.stop_key));
  return next;
}

// Returns the set of stop_keys that have a non-empty note or at least one photo —
// used to decide which stops show up in the Journal feed by default.
export function useJournalEntryKeys() {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setKeys(await fetchEntryKeys());
    setLoading(false);
  }, []);

  useEffect(() => {
    let ignore = false; // a late response after unmount must not set state
    fetchEntryKeys().then(next => {
      if (ignore) return;
      setKeys(next);
      setLoading(false);
    });
    return () => { ignore = true; };
  }, []);

  return { keys, loading, refetch };
}
