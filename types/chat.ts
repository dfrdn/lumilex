export interface ChatChannel {
  id: string;
  type: 'matter' | 'dm' | 'group';
  matter_id: string | null;
  name: string | null;
  member_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  // Computed on fetch
  last_message?: ChatMessage | null;
  unread_count?: number;
  matter_code?: string | null;
  matter_status?: string | null;
  dm_initials?: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  entity_refs: EntityRef[];
  attachments: ChatAttachment[];
  /** person_ids of users @mentioned in this message */
  mentions: string[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  // Joined on fetch
  sender_name?: string;
  sender_initials?: string;
  sender_avatar_url?: string | null;
  /** emoji → list of person_ids who reacted */
  reactions?: Record<string, string[]>;
}

export type ChatEntityType = 'deliverable' | 'task' | 'hearing' | 'meeting' | 'filing' | 'file';

export interface EntityRef {
  type: ChatEntityType;
  id: string;
  name: string;
  date?: string | null;
  status?: string | null;
}

export interface ChatAttachment {
  name: string;
  path: string;
  size: number;
  mime_type: string;
}

export interface ChatReadReceipt {
  channel_id: string;
  person_id: string;
  last_read_at: string;
  last_read_msg_id: string | null;
}

export interface ChatUnreadCounts {
  total: number;
  channels: Record<string, number>;
  /** Per-channel count of unread messages that @mention the current user */
  mention_counts: Record<string, number>;
}
