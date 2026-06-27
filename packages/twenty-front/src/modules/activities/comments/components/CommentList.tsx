import { styled } from '@linaria/react';

import { CommentTile } from '@/activities/comments/components/CommentTile';
import { type Comment } from '@/activities/comments/types/Comment';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type CommentListProps = {
  comments: Comment[];
};

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  padding: 8px 24px;
  width: calc(100% - 48px);
`;

export const CommentList = ({ comments }: CommentListProps) => (
  <StyledContainer>
    {comments.map((comment) => (
      <CommentTile key={comment.id} comment={comment} />
    ))}
  </StyledContainer>
);
