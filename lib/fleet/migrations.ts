/**
 * Which migrations an instance still needs, and in what order.
 *
 * Order comes from supabase/migration-versions.json, not from filenames. The
 * files are named `YYYYMMDD_description.sql`, and within one day that sorts
 * alphabetically — `20260822_firm_allocators.sql` ahead of
 * `20260822_firms_foundation.sql`, which creates what it depends on. The map
 * records the version each file was actually applied under on the test
 * project, which is the order that is known to work, and it is the same
 * `version` the ledger (`supabase_migrations.schema_migrations`) holds, so an
 * instance's applied set is read straight from its ledger.
 *
 * Pure. The IO half is scripts/fleet-migrate.ts.
 */

export interface Migration {
  file: string;
  version: string;
  name: string;
}

export interface ResolvedMigrations {
  migrations: Migration[];
  problems: string[];
}

const VERSION = /^\d{14}$/;

export function migrationName(file: string): string {
  return file.replace(/^\d+_/, '').replace(/\.sql$/, '');
}

/**
 * Join the directory listing with the version map. Every file needs exactly
 * one version, every version exactly one file, and no two files may share a
 * version — each of those is a way for two instances to end up with different
 * schemas while both report "up to date".
 */
export function resolveMigrations(
  files: readonly string[],
  versions: Readonly<Record<string, string>>,
): ResolvedMigrations {
  const problems: string[] = [];
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  const byVersion = new Map<string, string>();
  const migrations: Migration[] = [];

  for (const file of sqlFiles) {
    const version = versions[file];
    if (version === undefined) {
      problems.push(`${file} has no entry in migration-versions.json`);
      continue;
    }
    if (!VERSION.test(version)) {
      problems.push(`${file}: version "${version}" is not 14 digits (YYYYMMDDHHMMSS)`);
      continue;
    }
    const clash = byVersion.get(version);
    if (clash) {
      problems.push(`${file} and ${clash} share version ${version}`);
      continue;
    }
    byVersion.set(version, file);
    migrations.push({ file, version, name: migrationName(file) });
  }

  const present = new Set(sqlFiles);
  for (const file of Object.keys(versions)) {
    if (!present.has(file)) problems.push(`migration-versions.json names ${file}, which does not exist`);
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return { migrations, problems };
}

export interface AppliedRow {
  version: string;
  name: string | null;
}

export interface InstancePlan {
  pending: Migration[];
  /**
   * Pending migrations older than the newest one already applied. The instance
   * skipped something, or a file was given a back-dated version; applying it
   * now would run it against a schema it was never written for.
   */
  outOfOrder: Migration[];
  /** Ledger rows no file maps to — folded into a later file, or applied by hand. */
  unknownApplied: AppliedRow[];
  /** Same version, different name: the ledger and the map disagree about what ran. */
  nameMismatches: { version: string; file: string; ledgerName: string }[];
}

export function planInstance(migrations: readonly Migration[], applied: readonly AppliedRow[]): InstancePlan {
  const appliedByVersion = new Map(applied.map((r) => [r.version, r]));
  const known = new Set(migrations.map((m) => m.version));

  const pending = migrations.filter((m) => !appliedByVersion.has(m.version));
  const newestApplied = migrations
    .filter((m) => appliedByVersion.has(m.version))
    .reduce<string | null>((max, m) => (max === null || m.version > max ? m.version : max), null);
  const outOfOrder =
    newestApplied === null ? [] : pending.filter((m) => m.version < newestApplied);

  const unknownApplied = applied.filter((r) => !known.has(r.version));

  const nameMismatches = migrations.flatMap((m) => {
    const row = appliedByVersion.get(m.version);
    return row && row.name && row.name !== m.name
      ? [{ version: m.version, file: m.file, ledgerName: row.name }]
      : [];
  });

  return { pending, outOfOrder, unknownApplied, nameMismatches };
}
