const PATTERNS: [RegExp, string][] = [
  [/claude.*not found/i, "Claude Code isn't installed yet. Install it to get started."],
  [/cli.*not found/i, "Claude Code isn't installed yet. Install it to get started."],
  [/not found in PATH/i, "Claude Code isn't installed yet. Install it to get started."],
  [/rate.?limit/i, "Your co-founder is taking a short break (API limit reached). It'll resume automatically."],
  [/lock error/i, "Something went wrong. Try again in a moment."],
  [/failed to create workspace/i, "Couldn't create the project folder. Check your permissions."],
  [/workspace.*not.*exist/i, "The project folder doesn't exist anymore. Check the path and try again."],
  [/permission denied/i, "Permission denied. Check that you have access to this folder."],
  [/EACCES/i, "Permission denied. Check that you have access to this folder."],
  [/connection refused/i, "Couldn't connect. Check your internet connection and try again."],
  [/ECONNREFUSED/i, "Couldn't connect. Check your internet connection and try again."],
  [/timed? ?out/i, "The operation timed out. Try again in a moment."],
  [/disk.*full|no space/i, "Your disk is full. Free up some space and try again."],
  [/invalid.*api.*key/i, "The API key is invalid. Double-check it and try again."],
  [/Could not open folder/i, "Couldn't open the folder picker. Try again."],
  [/already exists/i, "A co-founder with this name already exists. Choose a different name."],
];

export function friendlyError(raw: string): { friendly: string; raw: string } {
  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(raw)) {
      return { friendly, raw };
    }
  }
  return { friendly: "Something unexpected happened.", raw };
}

export function extractError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
