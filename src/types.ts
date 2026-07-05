export interface User {
  id: string;
  email: string;
  username: string;
  avatar: string;
  status: string;
  online: boolean;
  lastSeen?: string;
  contacts: string[]; // List of user IDs (or member IDs if isGroup is true)
  devices?: ('desktop' | 'mobile')[]; // Live active connections
  isGroup?: boolean; // True if it is a group chat session
  creatorId?: string; // Creator of the group
  isChatbot?: boolean; // True if virtual AI chatbot
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  encrypted: boolean; // Indicates if stored server-side in encrypted format
  deletedForUsers?: string[]; // List of user IDs who deleted this message for themselves
}

export interface ChatSession {
  id: string; // usually receiver user id
  user: User;
  unreadCount: number;
  lastMessage?: Message;
}

// WebSocket Event types
export type WSEvent =
  | { type: 'register'; userId: string; deviceType?: 'desktop' | 'mobile' }
  | { type: 'message'; message: Message }
  | { type: 'message_status'; messageId: string; status: 'delivered' | 'read' }
  | { type: 'presence'; userId: string; online: boolean; devices?: ('desktop' | 'mobile')[]; lastSeen?: string }
  | { type: 'contact_added'; adderId: string; addedUser: User }
  | { type: 'typing'; senderId: string; receiverId: string; isTyping: boolean }
  | { type: 'delete_message'; messageId: string; senderId: string; receiverId: string; everyone?: boolean; deletedForUsers?: string[] };
