import { Module } from '@nestjs/common';

import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { TwentyOrmModule } from 'src/engine/twenty-orm/twenty-orm.module';
import { RecordCommentTimelineListener } from 'src/modules/comment-timeline/listeners/record-comment-timeline.listener';
import { TimelineActivityModule } from 'src/modules/timeline/timeline-activity.module';

@Module({
  imports: [
    TimelineActivityModule,
    TwentyOrmModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  providers: [RecordCommentTimelineListener],
})
export class CommentTimelineModule {}
