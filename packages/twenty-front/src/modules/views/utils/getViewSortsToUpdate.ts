import { areViewSortsEqual } from '@/views/utils/areViewSortsEqual';
import { isDefined } from 'twenty-shared/utils';
import { type ViewSort } from '@/views/types/ViewSort';
import { findCorrespondingViewSort } from '@/views/utils/findCorrespondingViewSort';

export const getViewSortsToUpdate = (
  currentViewSorts: ViewSort[],
  newViewSorts: ViewSort[],
) => {
  return newViewSorts
    .map((newViewSort) => {
      const correspondingViewSort = findCorrespondingViewSort(
        currentViewSorts,
        newViewSort,
      );

      if (!isDefined(correspondingViewSort)) {
        return undefined;
      }

      if (areViewSortsEqual(newViewSort, correspondingViewSort)) {
        return undefined;
      }

      // Keep the persisted row rather than replacing it, so changing a
      // direction does not move the sort to the end of the precedence order.
      return { ...newViewSort, id: correspondingViewSort.id };
    })
    .filter(isDefined);
};
