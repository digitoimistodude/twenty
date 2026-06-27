import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export type Comment = ObjectRecord & {
  body?: { blocknote?: string | null; markdown?: string | null } | null;
  createdBy?: { name?: string | null } | null;
  createdAt?: string;
};
