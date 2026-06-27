import { styled } from '@linaria/react';

import { CommentsCard } from '@/activities/comments/components/CommentsCard';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { SidePanelProvider } from '@/ui/layout/side-panel/contexts/SidePanelContext';

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
`;

type CommentWidgetProps = {
  widget: PageLayoutWidget;
};

export const CommentWidget = ({ widget: _widget }: CommentWidgetProps) => {
  const { isInSidePanel } = useLayoutRenderingContext();

  return (
    <SidePanelProvider value={{ isInSidePanel }}>
      <StyledContainer>
        <CommentsCard />
      </StyledContainer>
    </SidePanelProvider>
  );
};
