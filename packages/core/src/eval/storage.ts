import { readFile, readdir, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Context, Effect, Layer } from 'effect';
import {
  type EvaluationArtifact,
  type EvaluationArtifactSummary,
  stringifyEvaluationArtifact,
  validateEvaluationArtifact,
} from './artifact';

export interface TraceStorageApi {
  save: (artifact: EvaluationArtifact) => Effect.Effect<string, Error>;
  get: (traceId: string) => Effect.Effect<EvaluationArtifact | undefined, Error>;
  list: () => Effect.Effect<ReadonlyArray<EvaluationArtifactSummary>, Error>;
}

export class TraceStorageService extends Context.Tag('TraceStorageService')<
  TraceStorageService,
  TraceStorageApi
>() {}

export interface FileTraceStorageOptions {
  directory?: string;
}

export const FileTraceStorageLive = (options: FileTraceStorageOptions = {}) =>
  Layer.effect(
    TraceStorageService,
    Effect.sync(() => {
      const directory = options.directory ?? '.fred/eval/traces';

      const ensureDirectory = async (): Promise<void> => {
        await mkdir(directory, { recursive: true });
      };

      const filepathFor = (traceId: string): string => join(directory, `${traceId}.json`);

      return {
        save: (artifact: EvaluationArtifact) =>
          Effect.tryPromise({
            try: async () => {
              await ensureDirectory();
              const filepath = filepathFor(artifact.traceId);
              await writeFile(filepath, stringifyEvaluationArtifact(artifact), 'utf-8');
              return artifact.traceId;
            },
            catch: (cause) => new Error(`Failed to save evaluation trace: ${String(cause)}`),
          }),

        get: (traceId: string) =>
          Effect.tryPromise({
            try: async () => {
              const filepath = filepathFor(traceId);
              const content = await readFile(filepath, 'utf-8');
              const parsed: unknown = JSON.parse(content);
              if (!validateEvaluationArtifact(parsed)) {
                throw new Error(`Invalid evaluation artifact at ${filepath}`);
              }
              return parsed;
            },
            catch: (cause) => {
              if (
                cause &&
                typeof cause === 'object' &&
                'code' in cause &&
                (cause as { code?: string }).code === 'ENOENT'
              ) {
                return undefined;
              }
              return new Error(`Failed to read evaluation trace: ${String(cause)}`);
            },
          }).pipe(
            Effect.catchIf(
              (error): error is undefined => error === undefined,
              () => Effect.succeed(undefined)
            )
          ),

        list: () =>
          Effect.tryPromise({
            try: async () => {
              await ensureDirectory();
              const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
              const summaries: EvaluationArtifactSummary[] = [];

              for (const file of files) {
                const content = await readFile(join(directory, file), 'utf-8');
                const parsed: unknown = JSON.parse(content);
                if (!validateEvaluationArtifact(parsed)) {
                  continue;
                }

                summaries.push({
                  traceId: parsed.traceId,
                  runId: parsed.run.runId,
                  version: parsed.version,
                  environment: parsed.environment.environment,
                });
              }

              return summaries;
            },
            catch: (cause) => new Error(`Failed to list evaluation traces: ${String(cause)}`),
          }),
      } satisfies TraceStorageApi;
    })
  );
