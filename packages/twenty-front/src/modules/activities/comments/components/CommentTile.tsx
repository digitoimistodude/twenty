import { styled } from '@linaria/react';

import { type Comment } from '@/activities/comments/types/Comment';
import { getActivityPreview } from '@/activities/utils/getActivityPreview';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledCard = styled.div`
  align-items: flex-start;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledAuthor = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledBody = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  line-break: anywhere;
  white-space: pre-line;
  width: 100%;
`;

export const CommentTile = ({ comment }: { comment: Comment }) => {
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  const body = getActivityPreview(comment.body?.blocknote ?? null);
  const author = comment.createdBy?.name ?? 'Unknown';

  return (
    <StyledCard
      onClick={() =>
        openRecordInSidePanel({
          recordId: comment.id,
          objectNameSingular: 'recordComment',
        })
      }
    >
      <StyledAuthor>{author}</StyledAuthor>
      <StyledBody>{body}</StyledBody>
    </StyledCard>
  );
};
