import { type ViewSort } from '@/views/types/ViewSort';
import { compareStrictlyExceptForNullAndUndefined } from '~/utils/compareStrictlyExceptForNullAndUndefined';

// A view can only hold one sort per field, which is what the unique index on
// (fieldMetadataId, viewId) enforces. Matching on id instead would treat a
// re-picked field as a new sort and the insert would collide with the row
// already there.
export const findCorrespondingViewSort = (
  viewSorts: ViewSort[],
  viewSortToMatch: ViewSort,
) =>
  viewSorts.find(
    (viewSort) =>
      viewSort.fieldMetadataId === viewSortToMatch.fieldMetadataId &&
      compareStrictlyExceptForNullAndUndefined(
        viewSort.subFieldName,
        viewSortToMatch.subFieldName,
      ),
  );
