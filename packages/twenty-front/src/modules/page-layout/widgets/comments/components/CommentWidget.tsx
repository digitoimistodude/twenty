import { CommentsCard } from '@/activities/comments/components/CommentsCard';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { WidgetContentShell } from '@/page-layout/widgets/components/WidgetContentShell';

type CommentWidgetProps = {
  widget: PageLayoutWidget;
};

export const CommentWidget = ({ widget: _widget }: CommentWidgetProps) => (
  <WidgetContentShell>
    <CommentsCard />
  </WidgetContentShell>
);
