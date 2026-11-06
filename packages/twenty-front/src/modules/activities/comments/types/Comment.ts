import { type FieldRichTextValue } from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export type Comment = ObjectRecord & {
  body?: FieldRichTextValue | null;
  createdBy?: { name?: string | null } | null;
  createdAt?: string;
};
