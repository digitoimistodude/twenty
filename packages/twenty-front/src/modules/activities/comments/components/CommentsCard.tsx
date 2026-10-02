import { styled } from '@linaria/react';

import { CommentComposer } from '@/activities/comments/components/CommentComposer';
import { CommentList } from '@/activities/comments/components/CommentList';
import { useComments } from '@/activities/comments/hooks/useComments';
import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { SkeletonLoader } from '@/activities/components/SkeletonLoader';
import { EmptyState } from '@/ui/feedback/empty-state/components/EmptyState';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';

const StyledCommentsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: auto;
`;

export const CommentsCard = () => {
  const targetRecord = useTargetRecord();

  const { comments, loading, hasNextPage, fetchMoreComments, refetchComments } =
    useComments(targetRecord.id);

  const handleLastRowVisible = async () => {
    if (hasNextPage) {
      await fetchMoreComments();
    }
  };

  const isCommentsEmpty = comments.length === 0;

  return (
    <StyledCommentsContainer>
      <CommentComposer
        opportunityId={targetRecord.id}
        onCommentCreated={() => {
          refetchComments();
        }}
      />
      {loading && isCommentsEmpty ? (
        <SkeletonLoader />
      ) : isCommentsEmpty ? (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Title>No comments</EmptyState.Title>
            <EmptyState.Description>
              There are no comments on this record yet.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : (
        <>
          <CommentList comments={comments} />
          <CustomResolverFetchMoreLoader
            loading={loading}
            onLastRowVisible={handleLastRowVisible}
          />
        </>
      )}
    </StyledCommentsContainer>
  );
};
