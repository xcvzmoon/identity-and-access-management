import type { DatabaseConfig } from '../src/utils/env.ts';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import postgres, { PostgresError } from 'postgres';
import { useDatabaseEnv } from '../src/utils/env.ts';

const workspacePath = path.resolve(import.meta.dirname, '..');
const maintenanceDatabase = 'postgres';
const databaseMissing = '3D000';
const duplicateDatabase = '42P04';
const uniqueViolation = '23505';
const insufficientPrivilege = '42501';
const failureExitCode = 1;
const cliArgumentsOffset = 2;

async function ensureDatabase(config: DatabaseConfig): Promise<void> {
  const { host, port, user, password, database, ssl } = config;

  const options = {
    host,
    port,
    user,
    password,
    ssl,
  };

  const target = postgres({
    ...options,
    database,
  });

  try {
    await target`select 1`;
    return;
  } catch (error) {
    if (!(error instanceof PostgresError && error.code === databaseMissing)) {
      throw error;
    }
  } finally {
    await target.end();
  }

  const maintenance = postgres({
    ...options,
    database: maintenanceDatabase,
  });

  try {
    const [name] = await maintenance<{ fits: boolean }[]>`
      select octet_length(${database}::text) <= current_setting('max_identifier_length')::int as fits
    `;

    if (!name.fits) {
      throw new Error('DB_DATABASE exceeds the PostgreSQL identifier length limit.');
    }

    try {
      await maintenance`create database ${maintenance.identifier(database)}`;
    } catch (error) {
      if (error instanceof PostgresError && error.code === insufficientPrivilege) {
        throw new Error(
          `Creating ${JSON.stringify(database)} requires CREATEDB. Create it with an authorized PostgreSQL role and rerun the migration.`,
          { cause: error },
        );
      }

      if (
        error instanceof PostgresError &&
        (error.code === duplicateDatabase || error.code === uniqueViolation)
      ) {
        const [existing] = await maintenance<{ present: boolean }[]>`
          select exists(
            select 1 from pg_catalog.pg_database where datname::text = ${database}
          ) as present
        `;

        if (existing.present) {
          return;
        }
      }

      throw error;
    }

    process.stdout.write(`Created PostgreSQL database ${JSON.stringify(database)}.\n`);
  } finally {
    await maintenance.end();
  }
}

async function migrate(args: readonly string[]): Promise<number> {
  if (args.every((argument) => /^--ignore-conflicts(?:=(?:true|false))?$/u.test(argument))) {
    await ensureDatabase(useDatabaseEnv({ workspacePath }));
  }

  const result = spawnSync('vp', ['exec', 'drizzle-kit', 'migrate', ...args], {
    cwd: workspacePath,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? failureExitCode;
}

try {
  process.exitCode = await migrate(process.argv.slice(cliArgumentsOffset));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Database migration failed.'}\n`,
  );
  process.exitCode = failureExitCode;
}
