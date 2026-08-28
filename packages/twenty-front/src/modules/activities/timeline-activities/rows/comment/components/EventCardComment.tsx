import { styled } from '@linaria/react';

import { type Comment } from '@/activities/comments/types/Comment';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { getActivityPreview } from '@/activities/utils/getActivityPreview';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  max-width: 380px;
  width: 100%;
`;

const StyledAuthor = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledBody = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  white-space: pre-wrap;
`;

type EventCardCommentProps = {
  recordCommentId: string;
  authorFullName: string;
};

export const EventCardComment = ({
  recordCommentId,
  authorFullName,
}: EventCardCommentProps) => {
  const { record: comment } = useFindOneRecord<Comment>({
    objectNameSingular: 'recordComment',
    objectRecordId: recordCommentId,
    recordGqlFields: { id: true, body: true, createdBy: true, createdAt: true },
  });

  if (!isDefined(comment)) {
    return null;
  }

  return (
    <StyledContainer>
      <StyledAuthor>{comment.createdBy?.name ?? authorFullName}</StyledAuthor>
      <StyledBody>
        {getActivityPreview(comment.body?.blocknote ?? null)}
      </StyledBody>
    </StyledContainer>
  );
};
