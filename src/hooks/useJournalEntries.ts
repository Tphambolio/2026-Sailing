import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Returns the set of stop_keys that have a non-empty note or at least one photo —
// used to decide which stops show up in the Journal feed by default.
export function useJournalEntryKeys() {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [notesRes, photosRes] = await Promise.all([
      supabase.from('sailing_stop_notes').select('stop_key').neq('content', ''),
      supabase.from('sailing_stop_photos').select('stop_key'),
    ]);
    const next = new Set<string>();
    (notesRes.data ?? []).forEach(r => next.add(r.stop_key));
    (photosRes.data ?? []).forEach(r => next.add(r.stop_key));
    setKeys(next);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { keys, loading, refetch };
}
