import { MessageParticipantRole } from 'twenty-shared/types';

import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { MessagingOpportunityCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-opportunity-creation.service';

type Participant = {
  id: string;
  personId: string | null;
  handle: string;
  messageId: string;
  role: MessageParticipantRole;
};

const buildService = (participants: Participant[]) => {
  const rowsByObjectName: Record<string, unknown[]> = {
    message: [
      {
        id: 'message-1',
        subject: 'Tarjouspyyntö',
        text: 'Pyytäisin tarjouksen',
        receivedAt: new Date(),
        messageThreadId: 'thread-1',
      },
    ],
    messageParticipant: participants,
    person: [{ id: 'person-1', companyId: 'company-1' }],
    company: [{ id: 'company-1', name: 'Example Oy' }],
    opportunity: [],
  };

  const workspaceOrmManager = {
    executeInWorkspaceContext: async (callback: () => Promise<unknown>) =>
      callback(),
    getRepository: async (objectName: string) => ({
      find: async () => rowsByObjectName[objectName] ?? [],
    }),
  } as unknown as WorkspaceOrmManager;

  return new MessagingOpportunityCreationService(workspaceOrmManager);
};

const findCandidates = (participants: Participant[]) =>
  buildService(participants).findCandidates({
    workspaceId: 'workspace-1',
    internalDomain: 'dude.fi',
    sinceDays: 7,
  });

describe('MessagingOpportunityCreationService.findCandidates', () => {
  it('uses the external From sender', async () => {
    const candidates = await findCandidates([
      {
        id: 'participant-1',
        personId: 'person-1',
        handle: 'client@example.fi',
        messageId: 'message-1',
        role: MessageParticipantRole.FROM,
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].handle).toBe('client@example.fi');
  });

  it('falls back to Reply-To when a group rewrote From to itself', async () => {
    const candidates = await findCandidates([
      {
        id: 'participant-1',
        personId: null,
        handle: 'moro@dude.fi',
        messageId: 'message-1',
        role: MessageParticipantRole.FROM,
      },
      {
        id: 'participant-2',
        personId: 'person-1',
        handle: 'client@example.fi',
        messageId: 'message-1',
        role: MessageParticipantRole.REPLY_TO,
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].handle).toBe('client@example.fi');
    expect(candidates[0].personId).toBe('person-1');
    expect(candidates[0].companyId).toBe('company-1');
  });

  it('skips mail we sent ourselves', async () => {
    const candidates = await findCandidates([
      {
        id: 'participant-1',
        personId: 'person-internal',
        handle: 'rolle@dude.fi',
        messageId: 'message-1',
        role: MessageParticipantRole.FROM,
      },
      {
        id: 'participant-2',
        personId: 'person-1',
        handle: 'client@example.fi',
        messageId: 'message-1',
        role: MessageParticipantRole.TO,
      },
    ]);

    expect(candidates).toHaveLength(0);
  });
});
