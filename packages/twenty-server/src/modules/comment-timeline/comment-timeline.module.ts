import { Module } from '@nestjs/common';

import { TwentyOrmModule } from 'src/engine/twenty-orm/twenty-orm.module';
import { RecordCommentTimelineListener } from 'src/modules/comment-timeline/listeners/record-comment-timeline.listener';
import { TimelineActivityModule } from 'src/modules/timeline/timeline-activity.module';

@Module({
  imports: [TimelineActivityModule, TwentyOrmModule],
  providers: [RecordCommentTimelineListener],
})
export class CommentTimelineModule {}
