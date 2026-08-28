import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';

import { EventCard } from '@/activities/timeline-activities/rows/components/EventCard';
import { EventCardToggleButton } from '@/activities/timeline-activities/rows/components/EventCardToggleButton';
import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { EventRowItem } from '@/activities/timeline-activities/rows/components/EventRowItem';
import { EventCardComment } from '@/activities/timeline-activities/rows/comment/components/EventCardComment';
import { isTimelineActivityWithLinkedRecord } from '@/activities/timeline-activities/types/TimelineActivity';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type EventRowCommentProps = EventRowDynamicComponentProps;

const StyledEventRowCommentContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledRowContainer = styled.div`
  display: flex;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[1]};
`;

export const EventRowComment = ({
  event,
  authorFullName,
}: EventRowCommentProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <StyledEventRowCommentContainer>
      <StyledRowContainer>
        <EventRowItem>{authorFullName}</EventRowItem>
        <EventRowItem variant="action">{t`commented`}</EventRowItem>
        <EventCardToggleButton isOpen={isOpen} setIsOpen={setIsOpen} />
      </StyledRowContainer>
      <EventCard isOpen={isOpen}>
        {isTimelineActivityWithLinkedRecord(event) && (
          <EventCardComment
            recordCommentId={event.linkedRecordId}
            authorFullName={authorFullName}
          />
        )}
      </EventCard>
    </StyledEventRowCommentContainer>
  );
};
