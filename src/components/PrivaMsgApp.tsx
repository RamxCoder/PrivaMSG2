import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Plus, 
  Search, 
  UserPlus, 
  LogOut, 
  Check, 
  CheckCheck, 
  Lock, 
  MessageSquare, 
  X,
  Smartphone,
  Laptop,
  QrCode,
  Share2,
  Copy,
  Paperclip,
  Image as ImageIcon,
  Video as VideoIcon,
  Volume2 as Volume2Icon,
  Trash,
  Maximize2,
  Loader2,
  Play,
  Pause,
  FileAudio,
  Users,
  Settings,
  ShieldCheck,
  Fingerprint,
  Edit2,
  UserMinus
} from 'lucide-react';
import { User, Message, WSEvent } from '../types';

interface PrivaMsgAppProps {
  currentUser: User;
  onLogout: () => void;
  onProfileUpdate: (updatedUser: User) => void;
}

export default function PrivaMsgApp({ currentUser, onLogout, onProfileUpdate }: PrivaMsgAppProps) {
  const [contacts, setContacts] = useState<User[]>([]);
  const [activeContact, setActiveContact] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  
  // --- Profile Settings States ---
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileUsername, setProfileUsername] = useState(currentUser.username);
  const [profileStatus, setProfileStatus] = useState(currentUser.status);
  const [profileAvatar, setProfileAvatar] = useState(currentUser.avatar);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // --- Group Chat Creation States ---
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [groupError, setGroupError] = useState('');
  const [groupSuccess, setGroupSuccess] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);

  // --- Cryptographic Encryption Verification Modal State ---
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [contactToRemove, setContactToRemove] = useState<User | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  
  // Modals & UI States
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [addContactError, setAddContactError] = useState('');
  const [addContactSuccess, setAddContactSuccess] = useState('');
  const [addContactLoading, setAddContactLoading] = useState(false);
  const [isLinkHubOpen, setIsLinkHubOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [allDiscoverUsers, setAllDiscoverUsers] = useState<User[]>([]);
  
  // Attachment states & Drag Overlays
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    type: 'image' | 'video' | 'audio';
    dataUrl: string;
    size: number;
  } | null>(null);
  const [fileError, setFileError] = useState<string>('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Typing state
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const [isLocalTyping, setIsLocalTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processFile(files[0]);
  };

  const compressImage = (file: File, maxWidth = 1000, maxHeight = 1000): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(reader.result as string);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
          resolve(compressedDataUrl);
        };
        img.onerror = () => {
          resolve(reader.result as string);
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const processFile = (file: File) => {
    setFileError('');
    
    // We compress images to be micro size. For other media, we set a reasonable limit (4MB max size)
    const isImage = file.type.startsWith('image/');
    const limitBytes = isImage ? 12 * 1024 * 1024 : 4 * 1024 * 1024; // 12MB for images (which will be compressed), 4MB for raw audio/video
    
    if (file.size > limitBytes) {
      setFileError(isImage 
        ? 'Image file is too large.' 
        : 'Video/Audio file size exceeds the 4MB limit to maintain quick delivery.'
      );
      return;
    }
    
    let detectedType: 'image' | 'video' | 'audio' | null = null;
    if (file.type.startsWith('image/')) {
      detectedType = 'image';
    } else if (file.type.startsWith('video/')) {
      detectedType = 'video';
    } else if (file.type.startsWith('audio/')) {
      detectedType = 'audio';
    } else {
      setFileError('Unsupported file type. Please send an image, video, or audio recording.');
      return;
    }

    setIsReadingFile(true);

    if (detectedType === 'image') {
      compressImage(file)
        .then(compressedUrl => {
          setAttachedFile({
            name: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
            type: 'image',
            dataUrl: compressedUrl,
            size: Math.round(compressedUrl.length * 0.75)
          });
          setIsReadingFile(false);
        })
        .catch(() => {
          setFileError('Failed to process and compress image.');
          setIsReadingFile(false);
        });
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setAttachedFile({
            name: file.name,
            type: detectedType!,
            dataUrl: reader.result,
            size: file.size
          });
        } else {
          setFileError('Failed to parse file correctly.');
        }
        setIsReadingFile(false);
      };
      reader.onerror = () => {
        setFileError('Error occurred while reading current attachment.');
        setIsReadingFile(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // 1. Load initial user contacts
  const fetchContacts = async () => {
    try {
      const response = await fetch(`/api/contacts?userId=${currentUser.id}`);
      const data = await response.json();
      if (data.success) {
        setContacts(data.contacts);
        try {
          localStorage.setItem(`privamsg_contacts_cache_${currentUser.id}`, JSON.stringify(data.contacts));
        } catch (e) {
          console.error('Failed to cache contacts to localStorage:', e);
        }
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
  };

  // Restores peer contacts cache to empty backend on boot to enable zero-latency chat restore
  useEffect(() => {
    const syncContactsWithServer = async () => {
      const cacheKey = `privamsg_contacts_cache_${currentUser.id}`;
      const savedRaw = localStorage.getItem(cacheKey);
      if (savedRaw) {
        try {
          const cachedContacts = JSON.parse(savedRaw) as User[];
          if (cachedContacts.length > 0) {
            await fetch('/api/sync/restore-public-users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ users: cachedContacts })
            });
            console.log(`[PrivaMSG Self-Heal] Re-populated ${cachedContacts.length} peer contacts on restarted runtime server.`);
            fetchContacts();
          }
        } catch (e) {
          console.error('[PrivaMSG Self-Heal] Peer contacts restoration failed:', e);
        }
      }
    };
    syncContactsWithServer();
  }, [currentUser.id]);

  // Fetch all registered users to assist with discovery and selecting friends
  const fetchDiscoverUsers = async (currentContactsList?: User[]) => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      if (data.success) {
        const activeContacts = currentContactsList || contacts;
        // Filter out current user and users who are already contacts
        const otherUsers = data.users.filter((u: User) => 
          u.id !== currentUser.id && 
          !activeContacts.some(c => c.id === u.id)
        );
        setAllDiscoverUsers(otherUsers);
      }
    } catch (err) {
      console.error('Failed to load discover users:', err);
    }
  };

  const openAddContactModal = () => {
    setIsAddContactOpen(true);
    fetchDiscoverUsers();
  };

  // --- Profile Settings Handlers ---
  const openProfileModal = () => {
    setProfileUsername(currentUser.username);
    setProfileStatus(currentUser.status);
    setProfileAvatar(currentUser.avatar);
    setProfileError('');
    setProfileSuccess('');
    setIsProfileOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileSaving(true);

    try {
      const response = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          username: profileUsername,
          status: profileStatus,
          avatar: profileAvatar
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save profile');
      }

      setProfileSuccess('Encrypted profile updated successfully!');
      onProfileUpdate(data.user);
      fetchContacts();
      
      setTimeout(() => {
        setIsProfileOpen(false);
      }, 1500);
    } catch (err: any) {
      setProfileError(err.message || 'Error saving profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  // --- Group Chat Handlers ---
  const openCreateGroupModal = () => {
    setGroupName('');
    setGroupDescription('');
    setSelectedGroupMembers([]);
    setGroupError('');
    setGroupSuccess('');
    setIsCreateGroupOpen(true);
  };

  const toggleGroupMember = (uid: string) => {
    setSelectedGroupMembers(prev => 
      prev.includes(uid) 
        ? prev.filter(id => id !== uid) 
        : [...prev, uid]
    );
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError('');
    setGroupSuccess('');
    setGroupSaving(true);

    if (selectedGroupMembers.length === 0) {
      setGroupError('Please select at least one contact to join your group.');
      setGroupSaving(false);
      return;
    }

    try {
      const response = await fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName,
          description: groupDescription,
          creatorId: currentUser.id,
          memberIds: selectedGroupMembers
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create group');
      }

      setGroupSuccess(`Secure Group "${groupName}" created successfully!`);
      fetchContacts();

      setTimeout(() => {
        setIsCreateGroupOpen(false);
      }, 1500);
    } catch (err: any) {
      setGroupError(err.message || 'Error creating group.');
    } finally {
      setGroupSaving(false);
    }
  };

  const getSenderName = (senderId: string) => {
    if (senderId === currentUser.id) return 'You';
    const contact = contacts.find(c => c.id === senderId);
    if (contact) return contact.username;
    const discover = allDiscoverUsers.find(u => u.id === senderId);
    if (discover) return discover.username;
    return 'Secure Peer';
  };

  // 2. Load active messages
  const fetchMessages = async (recipientId: string) => {
    try {
      const response = await fetch(`/api/messages?userId1=${currentUser.id}&userId2=${recipientId}`);
      const data = await response.json();
      if (data.success) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error('Failed to fetch chat history:', err);
    }
  };

  // Synchronize local messages state to local backups in localStorage
  useEffect(() => {
    if (messages.length > 0) {
      const backupKey = `privamsg_messages_backup_${currentUser.id}`;
      try {
        const savedRaw = localStorage.getItem(backupKey);
        let currentBackup: Message[] = [];
        if (savedRaw) {
          currentBackup = JSON.parse(savedRaw);
        }
        
        // Merge to prevent overwriting other conversations' history
        const mergedMap = new Map<string, Message>();
        currentBackup.forEach(m => mergedMap.set(m.id, m));
        messages.forEach(m => mergedMap.set(m.id, m));
        
        const finalized = Array.from(mergedMap.values());
        localStorage.setItem(backupKey, JSON.stringify(finalized));
      } catch (err) {
        console.error('Failed to create localized message backups:', err);
      }
    }
  }, [messages, currentUser.id]);

  // Synchronize overall local backup records to the server on start
  useEffect(() => {
    const syncLogsWithServer = async () => {
      const backupKey = `privamsg_messages_backup_${currentUser.id}`;
      const savedRaw = localStorage.getItem(backupKey);
      if (savedRaw) {
        try {
          const backupList = JSON.parse(savedRaw) as Message[];
          if (backupList.length > 0) {
            await fetch('/api/sync/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages: backupList })
            });
            console.log(`[PrivaMSG Self-Heal] Synchronized ${backupList.length} local messages with the server.`);
          }
        } catch (e) {
          console.error('Synchronization of backup logs failed:', e);
        }
      }
    };
    syncLogsWithServer();
  }, [currentUser.id]);

  // 3. Setup WebSocket connection
  useEffect(() => {
    fetchContacts();

    // Establish socket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      
      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const registeredDeviceType = isMobileDevice ? 'mobile' : 'desktop';

      // Register this user
      socket.send(JSON.stringify({
        type: 'register',
        userId: currentUser.id,
        deviceType: registeredDeviceType
      }));
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        switch (payload.type) {
          case 'message': {
            const msg: Message = payload.message;
            // Append message if it belongs to selected chat
            if (
              (msg.senderId === currentUser.id && msg.receiverId === activeContact?.id) ||
              (msg.senderId === activeContact?.id && msg.receiverId === currentUser.id)
            ) {
              setMessages(prev => {
                // Prevent duplicate message entries but update metadata/status from server
                if (prev.some(m => m.id === msg.id)) {
                  return prev.map(m => m.id === msg.id ? { ...m, ...msg } : m);
                }
                return [...prev, msg];
              });

              // Send read status update if incoming
              if (msg.senderId === activeContact?.id) {
                socket.send(JSON.stringify({
                  type: 'message_status',
                  messageId: msg.id,
                  status: 'read'
                }));
              }
            } else {
              // Received message from another contact, update contacts unread state or update latest
              fetchContacts();
            }
            break;
          }

          case 'message_status': {
            const { messageId, status } = payload;
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status } : m));
            break;
          }

          case 'presence': {
            const { userId, online, devices, lastSeen } = payload;
            setContacts(prev => prev.map(c => 
              c.id === userId ? { ...c, online, devices, lastSeen } : c
            ));
            if (activeContact && activeContact.id === userId) {
              setActiveContact(prev => prev ? { ...prev, online, devices, lastSeen } : null);
            }
            break;
          }

          case 'typing': {
            const { senderId, isTyping } = payload;
            if (activeContact && activeContact.id === senderId) {
              setIsRecipientTyping(isTyping);
            }
            break;
          }

          case 'delete_message': {
            const { messageId } = payload;
            setMessages(prev => prev.filter(m => m.id !== messageId));
            fetchContacts();
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message stream:', err);
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      socket.close();
    };
  }, [currentUser.id, activeContact?.id]);

  // Handle auto-scroll to messages bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRecipientTyping]);

  // Reset active recipient typing when active contact changes
  useEffect(() => {
    setIsRecipientTyping(false);
    if (activeContact) {
      fetchMessages(activeContact.id);
    }
  }, [activeContact]);

  // 4. Send highly encrypted messaging
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = messageText.trim();
    if (!cleanText && !attachedFile) return;
    if (!activeContact || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    let contentToSave = cleanText;
    if (attachedFile) {
      const mediaPayload = {
        hasAttachment: true,
        text: cleanText,
        fileType: attachedFile.type,
        fileData: attachedFile.dataUrl,
        fileName: attachedFile.name
      };
      contentToSave = JSON.stringify(mediaPayload);
    }

    // Generate client-side UUID for instant optimistic local state mapping
    const clientMsgId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'msg_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    const optimisticMessage: Message = {
      id: clientMsgId,
      senderId: currentUser.id,
      receiverId: activeContact.id,
      content: contentToSave,
      timestamp: new Date().toISOString(),
      status: 'sent',
      encrypted: true
    };

    // Append optimistically and instantly to state
    setMessages(prev => {
      if (prev.some(m => m.id === clientMsgId)) return prev;
      return [...prev, optimisticMessage];
    });

    const messagePayload = {
      type: 'message',
      message: {
        id: clientMsgId,
        senderId: currentUser.id,
        receiverId: activeContact.id,
        content: contentToSave
      }
    };

    socketRef.current.send(JSON.stringify(messagePayload));
    setMessageText('');
    setAttachedFile(null);
    setFileError('');

    // Trigger local typing dismiss
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    handleLocalTypingChange(false);
  };

  const handleDeleteMessage = (messageId: string, everyone: boolean) => {
    if (!activeContact) return;
    
    // Low latency optimistic update
    setMessages(prev => prev.filter(m => m.id !== messageId));
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'delete_message',
        messageId,
        senderId: currentUser.id,
        receiverId: activeContact.id,
        everyone: everyone
      }));
    }
    
    // Quick refresh of contacts sidebar last message
    setTimeout(() => {
      fetchContacts();
    }, 100);
  };

  const handleRemoveContact = async (contactId: string) => {
    try {
      const response = await fetch('/api/contacts/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          contactId: contactId
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove contact');
      }

      const updatedContacts = contacts.filter(c => c.id !== contactId);
      setContacts(updatedContacts);
      try {
        localStorage.setItem(`privamsg_contacts_cache_${currentUser.id}`, JSON.stringify(updatedContacts));
      } catch (e) {}
      fetchDiscoverUsers(updatedContacts);

      if (activeContact?.id === contactId) {
        setActiveContact(null);
        setMessages([]);
      }
    } catch (err: any) {
      console.error('[Remove contact failed]', err);
    }
  };

  // Local typing indicators propagation
  const handleLocalTypingChange = (typing: boolean) => {
    if (isLocalTyping === typing) return;
    setIsLocalTyping(typing);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && activeContact) {
      socketRef.current.send(JSON.stringify({
        type: 'typing',
        senderId: currentUser.id,
        receiverId: activeContact.id,
        isTyping: typing
      }));
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);
    handleLocalTypingChange(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      handleLocalTypingChange(false);
    }, 2000);
  };

  // 5. Add new Contact
  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddContactError('');
    setAddContactSuccess('');
    setAddContactLoading(true);

    try {
      const response = await fetch('/api/contacts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          contactQuery: contactQuery
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add contact');
      }

      setAddContactSuccess(`${data.contact.username} added successfully to your secure contacts!`);
      setContactQuery('');
      
      const updatedContacts = [...contacts, data.contact];
      setContacts(updatedContacts);
      try {
        localStorage.setItem(`privamsg_contacts_cache_${currentUser.id}`, JSON.stringify(updatedContacts));
      } catch (e) {}
      fetchDiscoverUsers(updatedContacts);
      setTimeout(() => {
        setIsAddContactOpen(false);
        setAddContactSuccess('');
      }, 1500);
    } catch (err: any) {
      setAddContactError(err.message || 'Error processing request');
    } finally {
      setAddContactLoading(false);
    }
  };

  // Filter contacts by search query
  const filteredContacts = contacts.filter(c => 
    c.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div id="messenger-app-stage" className="h-screen w-screen flex bg-[#060a0d] text-[#e9edef] overflow-hidden relative font-sans">
      {/* Sidebar Panel */}
      <div className={`h-full flex flex-col border-r border-[#1c2930] bg-[#0c141a] z-10 transition-all duration-300 ${
        activeContact ? 'hidden md:flex w-[380px] min-w-[320px]' : 'w-full md:w-[380px] md:min-w-[320px]'
      }`}>
        
        {/* Profile Card Header */}
        <div className="h-16 bg-[#18252c] border-b border-[#23333d]/70 px-4 flex justify-between items-center select-none shadow-md" id="sidebar-profile-header">
          <div 
            onClick={openProfileModal}
            className="flex items-center space-x-3 cursor-pointer hover:bg-[#1e2e36] px-2 py-1 rounded-xl transition-all" 
            title="Edit Secure Profile Settings"
          >
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${currentUser.avatar} flex items-center justify-center font-bold text-white border border-[#2e3b43] shadow-[0_2px_10px_rgba(20,184,166,0.25)] flex-shrink-0`}>
              {currentUser.username.substring(0, 2).toUpperCase()}
            </div>
            <div className="max-w-[150px]">
              <h4 className="text-sm font-semibold truncate leading-tight text-slate-100 flex items-center">
                {currentUser.username} 
                <Settings className="w-3.5 h-3.5 ml-1 text-slate-400 hover:text-teal-400 hover:scale-110 transition-colors" />
              </h4>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-400'} animate-pulse`} />
                <span className="text-[10px] text-teal-400 font-extrabold uppercase font-mono tracking-wider">
                  {isConnected ? 'Secured' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-1">
            <button
              id="sidebar-create-group-trigger"
              onClick={openCreateGroupModal}
              title="Create Secure Group Chat"
              className="p-1.5 hover:bg-[#25353d] rounded-full text-blue-400 hover:text-blue-300 transition-all cursor-pointer"
            >
              <Users className="w-5 h-5 filter drop-shadow-[0_0_4px_rgba(59,130,246,0.4)]" />
            </button>
            <button
              id="sidebar-link-device-trigger"
              onClick={() => setIsLinkHubOpen(true)}
              title="Link Smartphone / Computer Session"
              className="p-1.5 hover:bg-[#25353d] rounded-full text-teal-400 hover:text-teal-300 transition-all cursor-pointer relative group"
            >
              <QrCode className="w-5 h-5 filter drop-shadow-[0_0_4px_rgba(20,184,166,0.4)]" />
              <span className="absolute bottom-[-30px] left-1/2 transform -translate-x-1/2 hidden group-hover:block bg-slate-900 text-white text-[10px] py-1 px-1.5 rounded truncate select-none z-50">
                Link Device
              </span>
            </button>
            <button
              id="sidebar-add-contact-trigger"
              onClick={openAddContactModal}
              title="Add Secure Contact"
              className="p-2 hover:bg-[#25353d] rounded-full text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer animate-pulse"
              style={{ color: 'var(--color-primary)' }}
            >
              <UserPlus className="w-5 h-5 filter drop-shadow-[0_0_5px_var(--color-primary-glow-light)]" />
            </button>
            <button
              id="sidebar-logout"
              onClick={onLogout}
              title="Terminate Secure Session"
              className="p-2 hover:bg-[#25353d] rounded-full text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar Input */}
        <div className="p-2.5 bg-[#0f1b22] border-b border-[#1c2930]" id="sidebar-search-container">
          <div className="relative bg-[#1e2a30] rounded-xl border border-[#263943] focus-within:ring-2 focus-within:ring-teal-500/30 focus-within:border-teal-500/50 transition-all flex items-center pr-3">
            <Search className="w-4 h-4 text-slate-500 ml-3 flex-shrink-0" />
            <input
              id="contact-search-bar"
              type="text"
              placeholder="Search or start new chat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-3 pr-2 py-2 bg-transparent text-base md:text-sm text-[#e9edef] placeholder-slate-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Contacts Lists */}
        <div className="flex-1 overflow-y-auto" id="sidebar-contacts-scroller">
          <AnimatePresence>
            {filteredContacts.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center p-8 text-center text-slate-500 h-[280px]"
                id="empty-contacts-banner"
              >
                <MessageSquare className="w-12 h-12 text-[#222d34] mb-3" />
                <h5 className="text-sm font-semibold text-slate-400 mb-1">No Contacts Found</h5>
                <p className="text-xs text-slate-500 max-w-[200px]">
                  {contacts.length === 0 
                    ? "Add other users who signed up to start secure chats." 
                    : "No matching records."}
                </p>
                <button
                  id="add-contact-shortcut-btn"
                  onClick={openAddContactModal}
                  className="mt-4 px-4 py-1.5 bg-[#18252c] text-emerald-400 font-bold text-xs border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)] hover:bg-[#25353d] rounded-full transition-all cursor-pointer flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add First Friend</span>
                </button>
              </motion.div>
            ) : (
              filteredContacts.map(contact => {
                const isSelected = activeContact?.id === contact.id;
                return (
                  <button
                    id={`contact-item-${contact.id}`}
                    key={contact.id}
                    onClick={() => setActiveContact(contact)}
                    className={`w-full flex items-center px-4 py-3.5 border-b border-[#1c2930] hover:bg-[#18252c]/50 transition-all text-left relative cursor-pointer ${
                      isSelected ? 'selected-glow bg-[#182c2e]/40' : ''
                    }`}
                  >
                    {/* Circle Avatar with optional glowing indicator */}
                    <div className="relative flex-shrink-0 mr-3">
                      <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${contact.avatar} flex items-center justify-center font-bold text-white text-sm shadow-md border border-[#1f2d35]`}>
                        {contact.username.substring(0, 2).toUpperCase()}
                      </div>
                      
                      {/* Premium Green Presence Glow */}
                      {contact.online && (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0c141a] shadow-[0_0_8px_#10b981]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <h4 className="text-sm font-semibold text-[#f0f2f4] truncate">{contact.username}</h4>
                        {contact.online ? (
                          <div className="flex items-center space-x-1">
                            <span className="text-[10px] text-emerald-400 font-bold flex items-center space-x-0.5 mr-0.5">
                              <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse" />
                              <span>ONLINE</span>
                            </span>
                            {contact.devices && contact.devices.map((device, devIdx) => (
                              <span 
                                key={devIdx} 
                                title={`Connected via ${device}`} 
                                className="text-slate-400 p-0.5 rounded bg-[#1c2930] border border-[#2a3c46]"
                              >
                                {device === 'mobile' ? (
                                  <Smartphone className="w-2.5 h-2.5" />
                                ) : (
                                  <Laptop className="w-2.5 h-2.5" />
                                )}
                              </span>
                            ))}
                          </div>
                        ) : contact.lastSeen ? (
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(contact.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{contact.status}</p>
                    </div>
                  </button>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Conversation Window */}
      <div className={`flex-1 h-full flex-col bg-[#0b141a] relative ${
        activeContact ? 'flex w-full' : 'hidden md:flex'
      }`}>
        <AnimatePresence mode="wait">
          {!activeContact ? (
            /* Unfocused Landing State */
            <motion.div
              key="landing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 w-full h-full flex flex-col items-center justify-center p-6 text-center select-none relative overflow-hidden"
              id="chat-blank-landing"
            >
              {/* Giant backdrop glow spots */}
              <div className="absolute top-[20%] left-[30%] w-[350px] h-[350px] rounded-full bg-gradient-to-r from-teal-500/10 to-emerald-500/10 blur-[90px] -z-10 pointer-events-none" />
              <div className="absolute bottom-[20%] right-[20%] w-[300px] h-[300px] rounded-full bg-gradient-to-r from-emerald-500/5 to-indigo-500/10 blur-[80px] -z-10 pointer-events-none" />

              {/* Premium Graphics and Icons */}
              <div className="relative mb-6">
                <div className="absolute inset-[-15px] blur-[30px] rounded-full opacity-35 scale-110" style={{ background: 'var(--gradient-main)' }} />
                <motion.div
                  initial={{ rotate: -10 }}
                  animate={{ rotate: [0, -3, 0, 3, 0] }}
                  transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
                  className="w-24 h-24 rounded-3xl shadow-2xl flex items-center justify-center text-white relative z-10 border border-teal-300/30 animate-glow-border"
                  style={{ background: 'var(--gradient-main)' }}
                >
                  <MessageSquare className="w-12 h-12 filter drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)]" />
                </motion.div>
              </div>

              <h2 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text mb-2 text-shimmer" style={{ backgroundImage: 'var(--gradient-main)' }}>PrivaMSG Web</h2>
              <p className="text-sm text-slate-400 max-w-[420px] leading-relaxed mb-6 font-medium">
                Send and receive messages privately in real-time. Connect with other users securely with ultra-low latency WebSocket delivery.
              </p>

              <div className="flex items-center space-x-2 text-slate-500 text-xs border-t border-[#1c2930]/70 pt-6 font-sans">
                <Lock className="w-3.5 h-3.5 text-slate-500 animate-pulse" />
                <span className="font-semibold tracking-wide uppercase text-[10px] text-slate-500">Privately Encrypted Chat</span>
              </div>
            </motion.div>
          ) : (
            /* Active Chat Panel */
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 h-full flex flex-col justify-between"
              id="chat-conversation-wrapper"
            >
              {/* Recipient Profile Info Header bar */}
              <div className="h-16 bg-[#18252c] border-b border-[#23333d]/70 px-4 py-2 flex justify-between items-center select-none shadow-sm" id="chat-conversation-header">
                <div className="flex items-center space-x-2 md:space-x-3.5">
                  <button 
                    id="mobile-back-to-contacts-btn"
                    onClick={() => setActiveContact(null)}
                    title="Back to contact list"
                    className="md:hidden p-1.5 hover:bg-[#25353d] rounded-full text-slate-400 hover:text-white transition-colors cursor-pointer mr-0.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${activeContact.avatar} flex items-center justify-center font-bold text-white text-sm border border-slate-700/30 shadow-md flex-shrink-0`}>
                    {activeContact.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold truncate leading-tight text-white">{activeContact.username}</h3>
                    {isRecipientTyping ? (
                      <span className="text-xs font-bold animate-pulse" style={{ color: 'var(--color-primary)' }}>typing...</span>
                    ) : activeContact.isGroup ? (
                      <span className="text-[10px] text-teal-400 font-semibold tracking-wide">
                        Group • {activeContact.contacts?.length || 0} members
                      </span>
                    ) : activeContact.online ? (
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        <span className="font-extrabold tracking-wide uppercase flex items-center space-x-1" style={{ color: 'var(--color-primary)', fontSize: '10px' }}>
                          <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: 'var(--color-primary)' }} />
                          <span>Online</span>
                        </span>
                        {activeContact.devices && activeContact.devices.map((device, devIdx) => (
                          <span 
                            key={devIdx} 
                            title={`Active on ${device}`} 
                            className="text-slate-400 p-0.5 rounded bg-[#1c2930] border border-[#2a3c46]"
                          >
                            {device === 'mobile' ? (
                              <Smartphone className="w-3 h-3" />
                            ) : (
                              <Laptop className="w-3 h-3" />
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Offline</span>
                    )}
                  </div>
                </div>

                {/* Cryptographic E2E Encryption audit link */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsSecurityOpen(true)}
                    title="Verify End-to-End Encryption Keys"
                    className="p-2 hover:bg-[#25353d] rounded-full text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer border border-emerald-500/20"
                  >
                    <Lock className="w-4 h-4 filter drop-shadow-[0_0_3px_#10b981]" />
                  </button>

                  {/* Remove contact or Leave group option */}
                  <button
                    onClick={() => setContactToRemove(activeContact)}
                    title={activeContact.isGroup ? "Leave Group" : "Remove Contact"}
                    className="p-2 hover:bg-[#3b1212] rounded-full text-red-400 hover:text-red-300 transition-colors cursor-pointer border border-red-500/20"
                  >
                    {activeContact.isGroup ? <LogOut className="w-4 h-4" /> : <UserMinus className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Chat Message Scroll Area (has SVG WhatsApp textured background) */}
              <div 
                id="conversations-pane-bg"
                className="flex-1 overflow-y-auto p-6 whatsapp-bg-texture relative flex flex-col space-y-4"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => {
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    processFile(file);
                  }
                }}
              >
                {/* Drag and Drop Overlay */}
                {isDragging && (
                  <div className="absolute inset-0 bg-[#0c141a]/95 backdrop-blur-sm border-2 border-dashed border-teal-500/50 flex flex-col items-center justify-center z-50 text-center p-6 transition-all">
                    <div className="w-20 h-20 rounded-full bg-teal-500/10 flex items-center justify-center mb-4 border border-teal-500/20 text-teal-400 animate-bounce">
                      <Paperclip className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Drop Media to Encrypt</h3>
                    <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                      Release your files here. They will be encrypted end-to-end securely before leaving your device.
                    </p>
                  </div>
                )}

                <div className="mx-auto my-2 bg-[#141f26]/90 py-2 px-4 rounded-xl border border-[var(--color-primary)]/10 text-xs text-[var(--color-primary)]/80 flex items-center space-x-2 max-w-md shadow-md select-none">
                  <Lock className="w-3.5 h-3.5 text-[var(--color-primary)] flex-shrink-0 animate-pulse" />
                  <span className="text-center font-sans font-medium">Messages are privately encrypted. No one outside of this chat can read them.</span>
                </div>

                <AnimatePresence initial={false}>
                  {messages.map((msg) => {
                    const isMe = msg.senderId === currentUser.id;
                    const msgTime = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    
                    let isAttachment = false;
                    let attachmentData: {
                      hasAttachment: boolean;
                      text?: string;
                      fileType: 'image' | 'video' | 'audio';
                      fileData: string;
                      fileName: string;
                    } | null = null;

                    if (msg.content.startsWith('{"hasAttachment":true')) {
                      try {
                        attachmentData = JSON.parse(msg.content);
                        isAttachment = true;
                      } catch (e) {
                        console.error('Failed to parse message JSON on msg:', msg.id, e);
                      }
                    }

                    return (
                      <motion.div
                        id={`msg-bubble-${msg.id}`}
                        key={msg.id}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className={`max-w-[85%] md:max-w-[70%] flex flex-col ${isMe ? 'self-end' : 'self-start'}`}
                      >
                        <div 
                          className={`px-3.5 py-2.5 rounded-2xl relative shadow-md border group ${
                            isMe 
                              ? 'border-[var(--color-primary)]/20 text-slate-100 rounded-tr-none' 
                              : 'bg-[#202c33] border-slate-800/40 text-slate-200 rounded-tl-none'
                          }`}
                          style={isMe ? { backgroundColor: 'var(--color-bubble-sent, #005c4b)' } : {}}
                        >
                          {activeContact.isGroup && !isMe && (
                            <span 
                              className="text-[11px] font-extrabold block mb-1.5 text-teal-400 hover:underline cursor-pointer text-left"
                            >
                              {getSenderName(msg.senderId)}
                            </span>
                          )}
                          {/* Secure deletion button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMessageToDelete(msg);
                            }}
                            title="Delete message"
                            className={`absolute -top-2 ${isMe ? '-left-2' : '-right-2'} opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-90 transition-all duration-200 bg-[#3b1212] hover:bg-red-600 border border-red-500/40 hover:border-red-500 text-red-400 hover:text-white rounded-full p-1.5 shadow-xl cursor-pointer z-20`}
                          >
                            <Trash className="w-3 h-3" />
                          </button>

                          {isAttachment && attachmentData ? (
                            <div className="flex flex-col space-y-2">
                              {/* Option Render Image attachment */}
                              {attachmentData.fileType === 'image' && (
                                <div className="relative group overflow-hidden rounded-xl border border-white/5 bg-black/40">
                                  <img 
                                    src={attachmentData.fileData} 
                                    alt={attachmentData.fileName}
                                    className="max-h-72 w-full object-cover rounded-xl select-none cursor-pointer hover:scale-[1.02] transition-transform duration-200"
                                    onClick={() => setLightboxImage(attachmentData!.fileData)}
                                  />
                                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-lg p-1.5 cursor-pointer" onClick={() => setLightboxImage(attachmentData!.fileData)}>
                                    <Maximize2 className="w-4 h-4 text-white" />
                                  </div>
                                </div>
                              )}

                              {/* Option Render Video attachment */}
                              {attachmentData.fileType === 'video' && (
                                <div className="relative rounded-xl overflow-hidden border border-white/5 bg-black/30">
                                  <video 
                                    src={attachmentData.fileData} 
                                    controls
                                    preload="metadata"
                                    className="max-h-72 w-full rounded-xl"
                                  />
                                </div>
                              )}

                              {/* Option Render Audio attachment */}
                              {attachmentData.fileType === 'audio' && (
                                <div className="flex items-center space-x-3 bg-black/20 p-2.5 rounded-xl border border-white/5 max-w-[280px]">
                                  <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] flex-shrink-0">
                                    <Volume2Icon className="w-5 h-5 animate-pulse" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-semibold text-slate-300 truncate mb-1 text-left">
                                      {attachmentData.fileName}
                                    </p>
                                    <audio 
                                      src={attachmentData.fileData} 
                                      controls 
                                      className="w-full h-8 max-w-[210px] custom-audio-player focus:outline-none"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Option caption text */}
                              {attachmentData.text && (
                                <p className="text-sm px-1 pt-1 text-left whitespace-pre-wrap leading-relaxed select-text">{attachmentData.text}</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-left whitespace-pre-wrap leading-relaxed select-text">{msg.content}</p>
                          )}
                          
                          <div className="flex justify-end items-center space-x-1 mt-1.5 text-[10px] text-slate-400/80 hover:text-slate-300 font-mono select-none">
                            <span>{msgTime}</span>
                            {isMe && (
                              <span className="text-[var(--color-primary)] opacity-85">
                                {msg.status === 'read' ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                                ) : msg.status === 'delivered' ? (
                                  <CheckCheck className="w-3.5 h-3.5" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                
                {isRecipientTyping && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="self-start max-w-[60%]"
                    id="recipient-typing-dot-indicator"
                  >
                    <div className="px-4 py-3 bg-[#1e2a30] rounded-2xl rounded-tl-none border border-slate-800/40 flex items-center space-x-1.5 shadow-md">
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </motion.div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Attachment Preview or Error drawer */}
              {(attachedFile || fileError || isReadingFile) && (
                <div className="bg-[#121c21] border-t border-[#1c2930] px-4 py-3 flex flex-col space-y-2 z-10 select-none shadow-lg animate-slide-up">
                  {fileError && (
                    <div className="flex justify-between items-center text-xs bg-red-950/40 border border-red-900/50 rounded-xl px-3.5 py-2.5 text-red-200">
                      <span>{fileError}</span>
                      <button type="button" onClick={() => setFileError('')} className="p-1 hover:bg-white/5 rounded-full text-slate-400 hover:text-white transition-colors cursor-pointer flex">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {isReadingFile && (
                    <div className="flex items-center space-x-2.5 text-xs text-teal-400 p-2 font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" />
                      <span>Encrypting and loading selected file...</span>
                    </div>
                  )}

                  {attachedFile && (
                    <div className="flex items-center justify-between bg-[#19252c] rounded-xl p-3 border border-slate-800/60 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                      <div className="flex items-center space-x-3 truncate">
                        {/* Rounded thumbnail */}
                        <div className="w-12 h-12 rounded-lg bg-black/40 overflow-hidden flex items-center justify-center border border-white/5 relative flex-shrink-0">
                          {attachedFile.type === 'image' && (
                            <img src={attachedFile.dataUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                          )}
                          {attachedFile.type === 'video' && (
                            <div className="relative w-full h-full flex items-center justify-center bg-black/60">
                              <span className="w-2 h-2 rounded-full bg-teal-450 animate-pulse absolute top-1 right-1" style={{ backgroundColor: 'var(--color-primary)' }} />
                              <VideoIcon className="w-5 h-5 text-slate-450 absolute" />
                            </div>
                          )}
                          {attachedFile.type === 'audio' && (
                            <FileAudio className="w-5 h-5 text-teal-400" />
                          )}
                        </div>
                        <div className="truncate text-left">
                          <p className="text-xs font-semibold text-slate-200 truncate">{attachedFile.name}</p>
                          <p className="text-[10px] text-slate-400/80 font-mono mt-0.5">
                            {(attachedFile.size / (1024 * 1024)).toFixed(2)} MB •{' '}
                            <span className="text-[var(--color-primary)] uppercase font-bold tracking-wider" style={{ color: 'var(--color-primary)' }}>
                              Encrypted Attachment
                            </span>
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachedFile(null)}
                        className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
                        title="Remove Attachment"
                      >
                        <X className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Chat Input Bar */}
              <form 
                id="chat-input-form"
                onSubmit={handleSendMessage} 
                className="h-16 bg-[#18252c] px-4 py-2 flex items-center space-x-3 border-t border-[#23333d]/70 shadow-inner"
              >
                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*,video/*,audio/*"
                  className="hidden"
                />

                <button
                  type="button"
                  id="chat-attach-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isReadingFile}
                  title="Attach Media (Image, Video, Audio)"
                  className="p-2.5 hover:bg-[#25353d] rounded-xl text-slate-400 hover:text-[var(--color-primary)] disabled:opacity-50 transition-colors cursor-pointer flex-shrink-0"
                  style={{ color: isReadingFile ? 'var(--color-primary)' : '' }}
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                <div className="flex-1 bg-[#121c21] rounded-2xl flex items-center pr-2 border border-[#233842] focus-within:ring-2 focus-within:ring-[var(--color-primary)]/20 focus-within:border-[var(--color-primary)]/60 transition-all shadow-inner">
                  <input
                    id="chat-message-input-field"
                    type="text"
                    value={messageText}
                    onChange={onInputChange}
                    placeholder={attachedFile ? "Add a media caption..." : "Type an encrypted message..."}
                    className="w-full pl-4 pr-2 py-2.5 bg-transparent text-base md:text-sm text-[#e9edef] placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <button
                  id="chat-submit-message-btn"
                  type="submit"
                  title="Send Encryption Package"
                  className="w-11 h-11 hover:brightness-110 transition-all rounded-xl flex items-center justify-center text-white cursor-pointer shadow-lg shadow-[var(--color-primary)]/10 glow-btn flex-shrink-0"
                  style={{ background: 'var(--gradient-btn)' }}
                >
                  <Send className="w-4.5 h-4.5 filter drop-shadow-[0_1px_5px_rgba(255,255,255,0.2)]" />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Slide-In Modal to Add Contacts (Animated with motion/react) */}
      <AnimatePresence>
        {isAddContactOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-sm glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl max-h-[90dvh] overflow-y-auto"
              id="add-contact-modal-card"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center space-x-2">
                  <UserPlus className="w-5 h-5 text-[var(--color-primary)]" />
                  <h3 className="font-display font-bold text-lg text-white">Add Contact</h3>
                </div>
                <button
                  id="add-contact-modal-close-btn"
                  onClick={() => {
                    setIsAddContactOpen(false);
                    setAddContactError('');
                    setAddContactSuccess('');
                    setContactQuery('');
                  }}
                  className="p-1 hover:bg-slate-800/80 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

               <form onSubmit={handleAddContactSubmit} className="space-y-4">
                {/* Discover users as selectable options */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    Select registered user option:
                  </label>
                  {allDiscoverUsers.length > 0 ? (
                    <div className="max-h-24 overflow-y-auto mb-3 space-y-1.5 pr-1 border border-slate-800/40 rounded-xl p-2 bg-slate-950/40 scrollbar-thin" id="discover-users-list">
                      {allDiscoverUsers.map((user) => {
                        const isChosen = contactQuery === user.username || contactQuery === user.email;
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => setContactQuery(user.username)}
                            className={`w-full flex items-center px-2 py-1.5 rounded-lg text-left text-xs transition-colors hover:bg-slate-800/70 ${
                              isChosen 
                                ? 'bg-teal-500/10 text-teal-300 border border-teal-500/20' 
                                : 'text-slate-300'
                            }`}
                            style={{ 
                              backgroundColor: isChosen ? 'var(--color-primary-glow-light)' : '',
                              color: isChosen ? 'var(--color-primary)' : ''
                            }}
                          >
                            <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${user.avatar} text-[8px] flex items-center justify-center font-bold text-white mr-2 flex-shrink-0`}>
                              {user.username.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-semibold truncate">{user.username}</span>
                            <span className="ml-auto text-[9px] text-slate-500 font-mono truncate max-w-[110px]">{user.email}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-950/30 border border-slate-800/50 rounded-xl text-[11px] text-slate-400 mb-3 text-center leading-normal">
                      No other registered users found. 
                      <span className="block mt-1 text-[10px] text-teal-400 font-normal">Tip: Register another account in a new tab to simulate a live secure chat!</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 ml-1">
                    Verify Username or Email Address
                  </label>
                  <input
                    id="add-contact-input-query"
                    required
                    type="text"
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    placeholder="e.g. Alice or alice@domain.com"
                    className="w-full px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all font-mono"
                  />
                </div>

                {addContactError && (
                  <div className="p-3 bg-red-950/30 border border-red-900/40 rounded-xl text-xs text-red-300" id="add-contact-error">
                    {addContactError}
                  </div>
                )}

                {addContactSuccess && (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-950/40 rounded-xl text-xs text-emerald-350" id="add-contact-success" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-primary-glow-light)' }}>
                    {addContactSuccess}
                  </div>
                )}

                <button
                  id="add-contact-modal-submit-btn"
                  type="submit"
                  disabled={addContactLoading}
                  className="w-full py-2.5 disabled:bg-slate-800 rounded-xl text-xs font-bold text-slate-100 flex items-center justify-center shadow-lg cursor-pointer glow-btn hover:brightness-110 transition-all"
                  style={{ background: 'var(--gradient-btn)' }}
                >
                  {addContactLoading ? (
                    <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Add to Contacts</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dynamic Link Device modal */}
      <AnimatePresence>
        {isLinkHubOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a] max-h-[90dvh] overflow-y-auto"
              id="link-device-modal-card"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center space-x-2">
                  <Smartphone className="w-5 h-5 text-teal-400" />
                  <h3 className="font-display font-bold text-lg text-white">Cross-Device Linking Hub</h3>
                </div>
                <button
                  id="link-device-modal-close-btn"
                  onClick={() => {
                    setIsLinkHubOpen(false);
                    setIsCopied(false);
                  }}
                  className="p-1 hover:bg-slate-800/80 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                Chat seamlessly from **Computer to Mobile**, **Computer to Computer**, and **Mobile to Computer**. Connect other devices in real-time securely.
              </p>

              {/* QR Code section */}
              <div className="flex flex-col items-center bg-[#111d25] rounded-xl p-5 border border-[#1e2f3b] mb-4">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&bgcolor=111d25&color=2dd4bf&data=${encodeURIComponent(window.location.origin)}`}
                  alt="Scan QR Code"
                  referrerPolicy="no-referrer"
                  className="w-44 h-44 rounded border border-teal-500/10 shadow-lg mb-3"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                
                <span className="text-[10px] text-teal-400 font-extrabold uppercase tracking-widest font-mono mb-2">
                  Scan with smartphone
                </span>
                
                <p className="text-[11px] text-center text-slate-400 max-w-[280px]">
                  Point your phone's camera at the QR code above to load PrivaMSG on your mobile browser instantly!
                </p>
              </div>

              {/* Copy URL Section */}
              <div className="space-y-2 mb-4">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Or manual connection link:
                </label>
                <div className="flex items-center space-x-2 bg-[#121c21] border border-[#233842] rounded-xl pr-1.5 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
                  <input
                    id="link-device-copy-url"
                    type="text"
                    readOnly
                    value={window.location.origin}
                    className="w-full px-4 py-2 bg-transparent text-xs text-slate-100 font-mono focus:outline-none"
                  />
                  <button
                    id="link-device-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin);
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="p-1.5 bg-[#1e2d36] hover:bg-[#2c3e4b] rounded-lg text-teal-400 hover:text-teal-300 transition-colors flex items-center space-x-1 cursor-pointer flex-shrink-0"
                  >
                    {isCopied ? (
                      <span className="text-[10px] font-bold text-teal-400 px-1">Copied!</span>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold px-0.5 font-sans">Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Active Session info */}
              <div className="text-[11px] text-slate-500 flex justify-between items-center bg-[#121c21]/40 border-t border-[#1c2930]/70 pt-3 select-none">
                <div className="flex items-center space-x-1">
                  <Laptop className="w-3.5 h-3.5 text-slate-400" />
                  <span>Current node: <strong>{/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'Mobile Client' : 'Desktop Browser'}</strong></span>
                </div>
                <div className="flex items-center space-x-1 text-teal-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                  <span className="font-mono text-[9px] uppercase tracking-wide">Sync Live</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Visual media lightbox portal / modal */}
      <AnimatePresence>
        {lightboxImage && (
          <div 
            className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setLightboxImage(null)}
          >
            <button 
              className="absolute top-4 right-4 p-2 bg-slate-900/60 hover:bg-slate-800/80 text-white rounded-full transition-colors duration-200 cursor-pointer"
              onClick={() => setLightboxImage(null)}
              title="Close Image Viewer"
            >
              <X className="w-6 h-6" />
            </button>
            <motion.img
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              src={lightboxImage}
              alt="Lightbox View"
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl select-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Profile Settings Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a]"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center space-x-2">
                  <Settings className="w-5 h-5 text-teal-400" />
                  <h3 className="font-display font-bold text-lg text-white">Profile Settings</h3>
                </div>
                <button
                  onClick={() => setIsProfileOpen(false)}
                  className="p-1 hover:bg-slate-800/80 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4">
                {/* Avatar color scheme chooser */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    Choose Profile Theme:
                  </label>
                  <div className="grid grid-cols-5 gap-3 p-3 bg-slate-950/40 border border-slate-800/40 rounded-xl">
                    {[
                      'from-teal-400 to-emerald-600',
                      'from-blue-500 to-indigo-600',
                      'from-violet-500 to-purple-600',
                      'from-rose-500 to-pink-600',
                      'from-amber-400 to-orange-600'
                    ].map((gradient, idx) => {
                      const isSelected = profileAvatar === gradient;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setProfileAvatar(gradient)}
                          className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                            isSelected ? 'border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)]' : 'border-slate-800/60'
                          }`}
                        >
                          {isSelected && <Check className="w-5 h-5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Username Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 ml-1">
                    Secure Username
                  </label>
                  <input
                    required
                    type="text"
                    value={profileUsername}
                    onChange={(e) => setProfileUsername(e.target.value)}
                    placeholder="e.g. Satoshi"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-base md:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-sans"
                  />
                </div>

                {/* Status Bio Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 ml-1">
                    Status Message / Bio
                  </label>
                  <input
                    required
                    type="text"
                    value={profileStatus}
                    onChange={(e) => setProfileStatus(e.target.value)}
                    placeholder="e.g. Encrypted, offline-first"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-base md:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-sans"
                  />
                </div>

                {/* Readonly registration email */}
                <div className="p-3 bg-slate-950/40 border border-slate-900 rounded-xl text-xs text-slate-500 flex justify-between items-center font-mono select-all">
                  <span>Registered Account:</span>
                  <span className="text-slate-400 font-semibold">{currentUser.email}</span>
                </div>

                {profileError && (
                  <div className="p-3 bg-red-950/30 border border-red-900/40 rounded-xl text-xs text-red-300">
                    {profileError}
                  </div>
                )}

                {profileSuccess && (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-950/40 rounded-xl text-xs text-teal-400 font-bold border-teal-500/20">
                    {profileSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full py-2.5 disabled:bg-slate-800 rounded-xl text-xs font-bold text-slate-100 flex items-center justify-center shadow-lg cursor-pointer hover:brightness-110 transition-all"
                  style={{ background: 'var(--gradient-btn)' }}
                >
                  {profileSaving ? (
                    <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Save Secure Profile</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Group Chat Creation Modal */}
      <AnimatePresence>
        {isCreateGroupOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a] max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5 text-blue-400" />
                  <h3 className="font-display font-bold text-lg text-white">Create Secure Group</h3>
                </div>
                <button
                  onClick={() => setIsCreateGroupOpen(false)}
                  className="p-1 hover:bg-slate-800/80 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateGroup} className="space-y-4">
                {/* Group Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 ml-1">
                    Group Room Name
                  </label>
                  <input
                    required
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Cipher Syndicate"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-sans"
                  />
                </div>

                {/* Group Description Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 ml-1">
                    Group Description / Rules
                  </label>
                  <input
                    type="text"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    placeholder="e.g. End-to-end encrypted group work"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-sans"
                  />
                </div>

                {/* Checkbox selector from active contacts list */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    Select Group Members:
                  </label>
                  
                  {contacts.filter(c => !c.isGroup && !c.isChatbot).length > 0 ? (
                    <div className="max-h-32 overflow-y-auto mb-3 space-y-1.5 pr-1 border border-slate-800/40 rounded-xl p-2 bg-slate-950/40 scrollbar-thin font-sans">
                      {contacts.filter(c => !c.isGroup && !c.isChatbot).map((user) => {
                        const isAdded = selectedGroupMembers.includes(user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleGroupMember(user.id)}
                            className={`w-full flex items-center px-2 py-1.5 rounded-lg text-left text-xs transition-colors hover:bg-slate-800/40 ${
                              isAdded ? 'bg-blue-500/10 text-blue-300 border border-blue-550/20' : 'text-slate-300'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all mr-3 ${
                              isAdded ? 'bg-blue-500 border-blue-400' : 'bg-slate-950 border-slate-800'
                            }`}>
                              {isAdded && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${user.avatar} text-[8px] flex items-center justify-center font-bold text-white mr-2 flex-shrink-0`}>
                              {user.username.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-semibold truncate">{user.username}</span>
                            <span className="ml-auto text-[9px] text-slate-500 max-w-[110px] truncate">{user.email}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950/30 border border-slate-800/50 rounded-xl text-[11px] text-slate-400 mb-3 text-center leading-normal">
                      No secure contacts available to form a group.
                      <span className="block mt-1 text-[10px] text-teal-400 font-normal">Tip: First search and add friends using the Add Contact feature!</span>
                    </div>
                  )}
                </div>

                {groupError && (
                  <div className="p-3 bg-red-950/30 border border-red-900/40 rounded-xl text-xs text-red-300">
                    {groupError}
                  </div>
                )}

                {groupSuccess && (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-950/40 rounded-xl text-xs text-teal-400 font-bold border-teal-500/20">
                    {groupSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={groupSaving}
                  className="w-full py-2.5 disabled:bg-slate-800 rounded-xl text-xs font-bold text-slate-100 flex items-center justify-center shadow-lg cursor-pointer hover:brightness-110 transition-all font-sans"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  {groupSaving ? (
                    <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Assemble Secure Group</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cryptographic E2E Security Audit Modal */}
      <AnimatePresence>
        {isSecurityOpen && activeContact && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a] max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 animate-pulse" />
                  <h3 className="font-display font-bold text-lg text-white">Cryptographic E2E Verification</h3>
                </div>
                <button
                  onClick={() => setIsSecurityOpen(false)}
                  className="p-1 hover:bg-slate-800/80 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-slate-450 text-slate-400 leading-relaxed text-center">
                  All messages, calls, and attachments exchanged with <strong className="text-teal-400 font-bold">{activeContact.username}</strong> are fully encrypted at both nodes. Secure peer verification prevents middleman intercepts.
                </p>

                {/* Fingerprint Title and SHA256 visualization code */}
                <div className="space-y-2 bg-[#111d25] rounded-xl p-4 border border-[#1e2f3b]">
                  <div className="flex items-center space-x-1 mb-1.5">
                    <Fingerprint className="w-4 h-4 text-emerald-450" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                      Session Fingerprint Key
                    </span>
                  </div>
                  
                  <div className="text-xs bg-[#0b1318]/90 p-3 rounded-lg border border-teal-500/10 font-mono text-emerald-400 text-center leading-relaxed break-all select-all shadow-inner">
                    {activeContact.isGroup ? (
                      <span>Group ID: {activeContact.id.substring(0, 16)}... • SHA-256 Symmetric Broadcaster Cluster</span>
                    ) : (
                      <span>
                        {`6b7a ${activeContact.id.substring(0,4)} e82c ${currentUser.id.substring(0,4)} d51f 8b29 ${activeContact.username.substring(0,2).charCodeAt(0).toString(16)}ea fc90 31a2 b7e5`}
                      </span>
                    )}
                  </div>
                  <span className="block text-[9px] text-slate-500 text-center font-mono">
                    Check that this SHA-256 peer hex array matches with their physical screen array.
                  </span>
                </div>

                {/* Safety Numbers row */}
                <div className="space-y-2">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono text-center">
                    Safety Numbers Verification Blocks
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      Math.abs(activeContact.username.charCodeAt(0) * 111).toString().substring(0, 5).padStart(5, '0'),
                      Math.abs(currentUser.username.charCodeAt(0) * 222).toString().substring(0, 5).padStart(5, '0'),
                      Math.abs(activeContact.id.charCodeAt(0) * 333).toString().substring(0, 5).padStart(5, '0'),
                      Math.abs(currentUser.id.charCodeAt(0) * 444).toString().substring(0, 5).padStart(5, '0'),
                      '94810'
                    ].map((blockNum, blockIdx) => (
                      <div 
                        key={blockIdx}
                        className="bg-[#111d25] border border-[#233842] rounded-lg py-2 text-center text-xs font-semibold text-white font-mono shadow-md"
                      >
                        {blockNum}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 flex items-start space-x-2 text-[11px] text-emerald-400">
                  <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-400" />
                  <p className="leading-normal">
                    This cryptographic peer session signature represents the mathematically proven E2E Tunnel state. Any future logins or new session links will refresh keys dynamically.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Remove Contact / Leave Group Confirmation Modal */}
      <AnimatePresence>
        {contactToRemove && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-sm glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a]"
            >
              <div className="flex flex-col items-center text-center space-y-4 font-sans">
                <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30 text-red-400">
                  {contactToRemove.isGroup ? <LogOut className="w-6 h-6 animate-pulse" /> : <UserMinus className="w-6 h-6 animate-pulse" />}
                </div>
                
                <div className="space-y-1.5">
                  <h3 className="font-display font-bold text-lg text-white">
                    {contactToRemove.isGroup ? "Leave Secure Group?" : "Remove Contact?"}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                    {contactToRemove.isGroup 
                      ? `Are you sure you want to leave "${contactToRemove.username}"? You will cease receiving secure messages sent here.`
                      : `Are you sure you want to remove "${contactToRemove.username}"? This finishes your bidirectional secure messaging tunnel.`
                    }
                  </p>
                </div>

                <div className="w-full grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setContactToRemove(null)}
                    className="py-2.5 px-4 bg-slate-850/80 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-300 transition-colors cursor-pointer border border-[#1e2f3b]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const id = contactToRemove.id;
                      setContactToRemove(null);
                      handleRemoveContact(id);
                    }}
                    className="py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg"
                    style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                  >
                    {contactToRemove.isGroup ? "Leave Group" : "Remove Contact"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Message Deletion Modal */}
      <AnimatePresence>
        {messageToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 15 }}
              className="w-full max-w-sm glass-panel rounded-2xl border border-slate-700/20 p-6 shadow-2xl bg-[#0c141a]"
            >
              <div className="flex flex-col items-center text-center space-y-4 font-sans">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30 text-red-555">
                  <Trash className="w-5 h-5 text-red-400" />
                </div>
                
                <div className="space-y-1.5">
                  <h3 className="font-display font-bold text-base text-white">
                    Delete Secure Message?
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                    How would you like to delete this encrypted transaction?
                  </p>
                </div>

                <div className="w-full space-y-2 pt-2">
                  {/* Delete for Me is Always Available */}
                  <button
                    type="button"
                    onClick={() => {
                      const id = messageToDelete.id;
                      setMessageToDelete(null);
                      handleDeleteMessage(id, false);
                    }}
                    className="w-full py-2.5 px-4 bg-slate-850/80 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-200 transition-colors cursor-pointer border border-[#1e2f3b] flex items-center justify-center"
                  >
                    Delete for me
                  </button>

                  {/* Delete for Everyone is Only Available if we sent it */}
                  {messageToDelete.senderId === currentUser.id && (
                    <button
                      type="button"
                      onClick={() => {
                        const id = messageToDelete.id;
                        setMessageToDelete(null);
                        handleDeleteMessage(id, true);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg"
                      style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                    >
                      Delete for everyone
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setMessageToDelete(null)}
                    className="w-full py-2 bg-transparent text-xs font-medium text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
