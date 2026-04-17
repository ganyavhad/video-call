export interface Participant {
  socketId: string;
  userId: string;
  displayName: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing?: boolean;
  stream?: MediaStream;
  audioStream?: MediaStream;
  videoStream?: MediaStream;
  isLocal?: boolean;
  consumers?: Map<string, any>;
}

export interface ChatMessage {
  socketId?: string;
  userId: string;
  displayName: string;
  message: string;
  timestamp: string;
}
