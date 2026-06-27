import { type Comment } from '@/activities/comments/types/Comment';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';

export const useComments = (opportunityId: string) => {
  const {
    records,
    loading,
    totalCount,
    fetchMoreRecords,
    hasNextPage,
    refetch,
  } = useFindManyRecords<Comment>({
    objectNameSingular: 'recordComment',
    filter: { opportunityId: { eq: opportunityId } },
    orderBy: [{ createdAt: 'DescNullsFirst' }],
    limit: 10,
  });

  return {
    comments: records,
    loading,
    totalCountComments: totalCount ?? 0,
    fetchMoreComments: fetchMoreRecords,
    hasNextPage,
    refetchComments: refetch,
  };
};
