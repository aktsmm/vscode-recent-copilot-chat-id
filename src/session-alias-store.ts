import { normalizeSessionAlias } from "./session-model";

const ALIASES_KEY = "agShowSessionId.sessionAliases";
const ALIAS_KEY_PREFIX = "agShowSessionId.sessionAlias.";

export interface AliasState {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface LegacyAliasSnapshot {
  readonly primary: Readonly<Record<string, string>>;
  readonly legacy: readonly Readonly<Record<string, string>>[];
}

export class SessionAliasStore {
  constructor(
    private readonly state: AliasState,
    private readonly legacyStates: readonly AliasState[] = [],
  ) {}

  get(id: string): string | undefined {
    return this.resolve(id, this.snapshotLegacyAliases());
  }

  getAll(ids: readonly string[] = []): Readonly<Record<string, string>> {
    if (ids.length > 0) {
      // One snapshot per batch keeps large legacy maps from being rebuilt per id.
      const snapshot = this.snapshotLegacyAliases();
      return Object.fromEntries(
        ids
          .map((id) => [id, this.resolve(id, snapshot)] as const)
          .filter((entry): entry is readonly [string, string] =>
            Boolean(entry[1]),
          ),
      );
    }
    return this.readLegacyAliases(this.state);
  }

  async migrate(ids: readonly string[]): Promise<void> {
    const snapshot = this.snapshotLegacyAliases();
    for (const id of ids) {
      if (this.readDirect(this.state, id) !== undefined) {
        continue;
      }
      const alias = this.resolve(id, snapshot);
      if (alias) {
        await this.state.update(`${ALIAS_KEY_PREFIX}${id}`, alias);
      }
    }
  }

  private snapshotLegacyAliases(): LegacyAliasSnapshot {
    return {
      primary: this.readLegacyAliases(this.state),
      legacy: this.legacyStates.map((state) => this.readLegacyAliases(state)),
    };
  }

  private resolve(
    id: string,
    snapshot: LegacyAliasSnapshot,
  ): string | undefined {
    const primary = this.readDirect(this.state, id);
    if (primary !== undefined) {
      return primary ?? undefined;
    }
    const primaryLegacy = snapshot.primary[id];
    if (primaryLegacy) {
      return primaryLegacy;
    }
    for (const [position, state] of this.legacyStates.entries()) {
      const direct = this.readDirect(state, id);
      if (direct !== undefined) {
        return direct ?? undefined;
      }
      const legacy = snapshot.legacy[position][id];
      if (legacy) {
        return legacy;
      }
    }
    return undefined;
  }

  private readDirect(state: AliasState, id: string): string | null | undefined {
    const missing = { missing: true };
    const value = state.get<unknown>(`${ALIAS_KEY_PREFIX}${id}`, missing);
    if (value === missing) {
      return undefined;
    }
    return typeof value === "string" ? value : null;
  }

  private readLegacyAliases(
    state: AliasState,
  ): Readonly<Record<string, string>> {
    const value = state.get<unknown>(ALIASES_KEY, {});
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  async set(id: string, value: string): Promise<void> {
    const alias = normalizeSessionAlias(value);
    await this.state.update(`${ALIAS_KEY_PREFIX}${id}`, alias ?? null);
  }

  async clear(id: string): Promise<void> {
    await this.set(id, "");
  }
}
