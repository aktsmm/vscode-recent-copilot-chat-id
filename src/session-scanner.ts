const SESSION_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(json|jsonl)$/i;

export interface StoredSessionFile {
  readonly name: string;
  readonly modifiedAt: number;
}

export interface SavedSession {
  readonly id: string;
  readonly modifiedAt: number;
}

export function parseSessionId(fileName: string): string | undefined {
  return SESSION_FILE_PATTERN.exec(fileName)?.[1].toLowerCase();
}

export function buildSavedSessions(
  files: readonly StoredSessionFile[],
): SavedSession[] {
  const sessionsById = new Map<string, SavedSession>();

  for (const file of files) {
    const id = parseSessionId(file.name);
    if (!id) {
      continue;
    }

    const existing = sessionsById.get(id);
    if (!existing || file.modifiedAt > existing.modifiedAt) {
      sessionsById.set(id, { id, modifiedAt: file.modifiedAt });
    }
  }

  return sortSessions([...sessionsById.values()]);
}

/** Keeps the newest timestamp because `.json` and `.jsonl` siblings share one ID. */
export function upsertSavedSession(
  sessions: readonly SavedSession[],
  file: StoredSessionFile,
): SavedSession[] {
  const id = parseSessionId(file.name);
  if (!id) {
    return [...sessions];
  }

  const others = sessions.filter((session) => session.id !== id);
  const existing = sessions.find((session) => session.id === id);
  const modifiedAt = Math.max(file.modifiedAt, existing?.modifiedAt ?? 0);

  return sortSessions([...others, { id, modifiedAt }]);
}

function sortSessions(sessions: SavedSession[]): SavedSession[] {
  return sessions.sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt || left.id.localeCompare(right.id),
  );
}

export function isMostRecentAmbiguous(
  sessions: readonly SavedSession[],
): boolean {
  return (
    sessions.length > 1 && sessions[0].modifiedAt === sessions[1].modifiedAt
  );
}

export function shortenSessionId(id: string): string {
  return id.slice(0, 8);
}
