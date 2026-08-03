import { Module } from '@nestjs/common';

import { ObjectMetadataRepositoryModule } from 'src/engine/object-metadata-repository/object-metadata-repository.module';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';
import { RecordCommentTimelineListener } from 'src/modules/comment-timeline/listeners/record-comment-timeline.listener';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

@Module({
  imports: [
    ObjectMetadataRepositoryModule.forFeature([
      TimelineActivityWorkspaceEntity,
    ]),
    TwentyORMModule,
  ],
  providers: [RecordCommentTimelineListener],
})
export class CommentTimelineModule {}
