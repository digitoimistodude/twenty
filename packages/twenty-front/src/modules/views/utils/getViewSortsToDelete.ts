import { isDefined } from 'twenty-shared/utils';
import { type ViewSort } from '@/views/types/ViewSort';
import { findCorrespondingViewSort } from '@/views/utils/findCorrespondingViewSort';

export const getViewSortsToDelete = (
  currentViewSorts: ViewSort[],
  newViewSorts: ViewSort[],
) => {
  return currentViewSorts.filter(
    (currentViewSort) =>
      !isDefined(findCorrespondingViewSort(newViewSorts, currentViewSort)),
  );
};
