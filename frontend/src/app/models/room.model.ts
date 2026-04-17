export interface Room {
  id: string;
  name: string;
  description?: string;
  room_code: string;
  host_id: string;
  host_name?: string;
  max_participants: number;
  is_active: boolean;
  is_locked: boolean;
  settings: RoomSettings;
  created_at: string;
}

export interface RoomSettings {
  allowScreenShare: boolean;
  allowChat: boolean;
  muteOnEntry: boolean;
  videoOffOnEntry: boolean;
}

export interface Meeting {
  id: string;
  room_id: string;
  room_name?: string;
  room_code?: string;
  host_id: string;
  host_name?: string;
  started_at: string;
  ended_at?: string;
  duration?: number;
  participant_count: number;
}
