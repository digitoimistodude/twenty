import { type NestExpressApplication } from '@nestjs/platform-express';

import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { getQueueToken } from 'src/engine/core-modules/message-queue/utils/get-queue-token.util';
import { WorkspaceMigrationRunnerService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/workspace-migration-runner.service';

// With the real BullMQ driver, a mutation's side-effect jobs keep running after the
// request returns. Migrations take exclusive table locks under a short lock_timeout,
// so a leftover job holding the lock makes the migration time out and the test flake.
// Every migration funnels through run(), so we drain the queues here — once, before
// the lock — instead of at every call site where it could be forgotten.
export const enforceJobQuiescenceBeforeMigrations = (
  app: NestExpressApplication,
): void => {
  const migrationRunner = app.get(WorkspaceMigrationRunnerService, {
    strict: false,
  });
  const messageQueueService = app.get<MessageQueueService>(
    getQueueToken(MessageQueue.cronQueue),
    { strict: false },
  );

  const runMigration = migrationRunner.run;

  migrationRunner.run = async (args: Parameters<typeof runMigration>[0]) => {
    await messageQueueService.waitForIdle();

    return runMigration(args);
  };
};
