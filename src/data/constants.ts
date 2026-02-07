// Shared constants for Mediterranean Odyssey

// Non-Schengen countries (Schengen counter pauses here)
export const NON_SCHENGEN = [
  'Montenegro',
  'Albania',
  'Turkey',
  'Cyprus',
  'Northern Cyprus',
  'Cyprus (UK base)',
];

// Country colors for map display and UI (keyed by country name)
export const COUNTRY_COLORS: Record<string, string> = {
  'Croatia': '#3b82f6',         // blue
  'Montenegro': '#a855f7',      // purple
  'Albania': '#f97316',         // orange
  'Greece': '#22c55e',          // green
  'Turkey': '#ef4444',          // red
  'Northern Cyprus': '#fbbf24', // yellow
  'Cyprus': '#6366f1',          // indigo
  'Italy': '#0ea5e9',           // sky
};

// Country flag emojis
export const COUNTRY_FLAGS: Record<string, string> = {
  'Italy': '\u{1F1EE}\u{1F1F9}',
  'Croatia': '\u{1F1ED}\u{1F1F7}',
  'Montenegro': '\u{1F1F2}\u{1F1EA}',
  'Albania': '\u{1F1E6}\u{1F1F1}',
  'Greece': '\u{1F1EC}\u{1F1F7}',
  'Turkey': '\u{1F1F9}\u{1F1F7}',
  'Cyprus': '\u{1F1E8}\u{1F1FE}',
  'Cyprus (UK base)': '\u{1F1EC}\u{1F1E7}',
  'Northern Cyprus': '\u{1F1F9}\u{1F1F7}',
};
