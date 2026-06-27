import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type Comment } from '@/activities/comments/types/Comment';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { RichTextFieldEditor } from '@/object-record/record-field/ui/meta-types/input/components/RichTextFieldEditor';

const StyledComposer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: 8px 24px;
  width: calc(100% - 48px);
`;

const StyledActions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

type CommentComposerProps = {
  opportunityId: string;
  onCommentCreated?: () => void;
};

export const CommentComposer = ({
  opportunityId,
  onCommentCreated,
}: CommentComposerProps) => {
  const [draftCommentId, setDraftCommentId] = useState<string | null>(null);

  const { createOneRecord } = useCreateOneRecord<Comment>({
    objectNameSingular: 'recordComment',
  });

  const handleAddComment = async () => {
    const created = await createOneRecord({ opportunityId });

    if (isDefined(created)) {
      setDraftCommentId(created.id);
    }
  };

  const handleDone = () => {
    setDraftCommentId(null);
    onCommentCreated?.();
  };

  return (
    <StyledComposer>
      {isDefined(draftCommentId) ? (
        <>
          <RichTextFieldEditor
            recordId={draftCommentId}
            objectNameSingular="recordComment"
            fieldName="body"
          />
          <StyledActions>
            <Button
              title={t`Done`}
              variant="secondary"
              size="small"
              onClick={handleDone}
            />
          </StyledActions>
        </>
      ) : (
        <Button
          Icon={IconPlus}
          title={t`Add comment`}
          variant="secondary"
          size="small"
          onClick={handleAddComment}
        />
      )}
    </StyledComposer>
  );
};
