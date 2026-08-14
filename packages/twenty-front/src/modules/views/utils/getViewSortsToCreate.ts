import { isDefined } from 'twenty-shared/utils';
import { type ViewSort } from '@/views/types/ViewSort';
import { findCorrespondingViewSort } from '@/views/utils/findCorrespondingViewSort';

export const getViewSortsToCreate = (
  currentViewSorts: ViewSort[],
  newViewSorts: ViewSort[],
) => {
  return newViewSorts.filter((newViewSort) => {
    const correspondingViewSort = findCorrespondingViewSort(
      currentViewSorts,
      newViewSort,
    );

    const shouldCreateBecauseViewSortIsNew = !isDefined(correspondingViewSort);

    return shouldCreateBecauseViewSortIsNew;
  });
};
