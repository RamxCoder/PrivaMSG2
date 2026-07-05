import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MongoClient, Collection } from 'mongodb';
import { User, Message } from '../src/types';

// Use a safe key for AES-256-CBC (must be 32 bytes)
const DB_ENCRYPTION_KEY = (process.env.DB_ENCRYPTION_KEY || 'privamsg-ultra-secure-key-32chars!').substring(0, 32).padEnd(32, 'x');
const IV_LENGTH = 16;

export function encryptText(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(DB_ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    return 'encrypted_err:' + Buffer.from(text).toString('base64');
  }
}

export function decryptText(encryptedText: string): string {
  try {
    if (encryptedText.startsWith('encrypted_err:')) {
      return Buffer.from(encryptedText.substring(14), 'base64').toString('utf8');
    }
    const parts = encryptedText.split(':');
    if (parts.length < 2) return encryptedText;
    const iv = Buffer.from(parts.shift()!, 'hex');
    const encryptedContent = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(DB_ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedContent);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    return 'Decryption failure (Key mismatch)';
  }
}

// User object used inside DB
interface DBUser extends User {
  passwordHash: string;
  salt: string;
}

// Database wrapper
class PrivateMessageDB {
  private usersFile: string;
  private messageFile: string;
  private users: DBUser[] = [];
  private messages: Message[] = [];
  private bucketId = 'privamsg_token_28a6529a'; // Fallback value
  private mongoClient: MongoClient | null = null;
  private mongoConnected = false;
  private usersColl: Collection<DBUser> | null = null;
  private messagesColl: Collection<Message> | null = null;
  private connectPromise: Promise<void> | null = null;

  private async getOrInitializeBucketId(): Promise<string> {
    const bucketIdFile = path.join(process.cwd(), 'data', 'bucket_id.txt');
    if (fs.existsSync(bucketIdFile)) {
      const saved = fs.readFileSync(bucketIdFile, 'utf8').trim();
      if (/^k[a-z0-9]{11}$/.test(saved)) {
        this.bucketId = saved;
        return saved;
      }
    }

    try {
      console.log('[PrivaMSG CloudSync] Generating a new, valid bucket ID on kvdb.io to prevent 404 errors...');
      const res = await fetch('https://kvdb.io', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'secret=true'
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        const match = text.match(/k[a-z0-9]{11}/);
        if (match) {
          const newBucketId = match[0];
          fs.writeFileSync(bucketIdFile, newBucketId, 'utf8');
          this.bucketId = newBucketId;
          console.log('[PrivaMSG CloudSync] Successfully provisioned new cloud backup key-value bucket:', newBucketId);
          return newBucketId;
        } else {
          // If response is the clean id itself
          const cleanIdMatch = text.match(/[a-z0-0k]+/i);
          if (cleanIdMatch && cleanIdMatch[0].length >= 10) {
            const cleanId = cleanIdMatch[0].toLowerCase();
            fs.writeFileSync(bucketIdFile, cleanId, 'utf8');
            this.bucketId = cleanId;
            console.log('[PrivaMSG CloudSync] Successfully provisioned clean cloud backup key-value bucket name:', cleanId);
            return cleanId;
          }
        }
      }
      console.warn('[PrivaMSG CloudSync] kvdb.io output was unexpected or empty. Response code:', res.status);
    } catch (err) {
      console.error('[PrivaMSG CloudSync] Error provisioning dynamic bucket ID on kvdb.io:', err);
    }
    return this.bucketId;
  }

  private processAndSaveAttachment(msgId: string, content: string): string {
    if (content.startsWith('{"hasAttachment":true')) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.hasAttachment && parsed.fileData && parsed.fileData.startsWith('data:')) {
          const attachmentsDir = path.join(process.cwd(), 'data', 'attachments');
          if (!fs.existsSync(attachmentsDir)) {
            fs.mkdirSync(attachmentsDir, { recursive: true });
          }

          const fileData = parsed.fileData;
          const attachmentPath = path.join(attachmentsDir, `${msgId}.dat`);
          
          // Save locally
          fs.writeFileSync(attachmentPath, fileData, 'utf8');
          console.log(`[PrivaMSG Attachments] Saved attachment locally for message ${msgId}`);

          // Fire-and-forget background upload to KVDB.io so it will survive server restarts
          if (!process.env.MONGODB_URI) {
            fetch(`https://kvdb.io/${this.bucketId}/attachment_${msgId}`, {
              method: 'POST',
              body: fileData,
              headers: { 'Content-Type': 'text/plain' }
            }).then(res => {
              if (res.ok) {
                console.log(`[PrivaMSG Attachments] Successfully synced attachment ${msgId} to KVDB.io`);
              } else {
                console.warn(`[PrivaMSG Attachments] Failed to sync attachment ${msgId} to KVDB.io:`, res.status);
              }
            }).catch(err => {
              console.error(`[PrivaMSG Attachments] Error uploading attachment ${msgId} to KVDB.io:`, err);
            });
          }

          // Modify payload to point to our secure Express served asset endpoint
          parsed.fileData = `/api/attachments/${msgId}`;
          return JSON.stringify(parsed);
        }
      } catch (err) {
        console.error('[PrivaMSG Attachments] Error parsing attachment content json:', err);
      }
    }
    return content;
  }

  public async getAttachment(id: string): Promise<string | null> {
    const attachmentsDir = path.join(process.cwd(), 'data', 'attachments');
    const attachmentPath = path.join(attachmentsDir, `${id}.dat`);

    if (fs.existsSync(attachmentPath)) {
      try {
        return fs.readFileSync(attachmentPath, 'utf8');
      } catch (err) {
        console.error(`[PrivaMSG Attachments] Failed to read local attachment ${id}:`, err);
        return null;
      }
    }

    // Missing locally! Try to lazy-fetch from KVDB.io
    console.log(`[PrivaMSG Attachments] Local attachment ${id} missing. Attempting lazy restore from KVDB.io...`);
    try {
      const kvdbRes = await fetch(`https://kvdb.io/${this.bucketId}/attachment_${id}`);
      if (kvdbRes.ok) {
        const rawData = await kvdbRes.text();
        if (rawData && rawData.trim() !== '') {
          if (!fs.existsSync(attachmentsDir)) {
            fs.mkdirSync(attachmentsDir, { recursive: true });
          }
          fs.writeFileSync(attachmentPath, rawData, 'utf8');
          console.log(`[PrivaMSG Attachments] Successfully lazy-restored attachment ${id} from KVDB.io and cached it.`);
          return rawData;
        }
      } else {
        console.warn(`[PrivaMSG Attachments] Lazy restore from KVDB.io returned status ${kvdbRes.status} for attachment ${id}`);
      }
    } catch (err) {
      console.error(`[PrivaMSG Attachments] Error lazy restoring attachment ${id} from KVDB.io:`, err);
    }

    return null;
  }

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.usersFile = path.join(dataDir, 'users.json');
    this.messageFile = path.join(dataDir, 'messages.json');

    this.loadData();
    this.connectPromise = this.connectMongo();
  }

  private async connectMongo() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log('[PrivaMSG Mongo] MONGODB_URI is not configured. Running with standard secure JSON filesystem.');
      return;
    }

    try {
      console.log('[PrivaMSG Mongo] Connecting to MongoDB Atlas...');
      const client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000
      });
      await client.connect();
      
      const mongoDb = client.db('privamsg');
      this.usersColl = mongoDb.collection<DBUser>('users');
      this.messagesColl = mongoDb.collection<Message>('messages');
      this.mongoClient = client;
      this.mongoConnected = true;
      console.log('[PrivaMSG Mongo] Successfully connected to MongoDB Atlas! Loaded production cloud DB.');

      // Hydrate memory from MongoDB
      const mongoUsers = await this.usersColl.find({}).toArray();
      const mongoMessages = await this.messagesColl.find({}).toArray();

      if (mongoUsers.length > 0) {
        this.users = mongoUsers;
        this.saveUsersLocally(); // Sync backup
        console.log(`[PrivaMSG Mongo] Hydrated ${this.users.length} users dynamically from MongoDB Atlas.`);
      } else if (this.users.length > 0) {
        console.log('[PrivaMSG Mongo] MongoDB users table empty. Seeding with local accounts...');
        await this.usersColl.insertMany(this.users);
      }

      if (mongoMessages.length > 0) {
        this.messages = mongoMessages;
        this.saveMessagesLocally(); // Sync backup
        console.log(`[PrivaMSG Mongo] Hydrated ${this.messages.length} messages dynamically from MongoDB Atlas.`);
      } else if (this.messages.length > 0) {
        console.log('[PrivaMSG Mongo] MongoDB messages table empty. Seeding with local history database...');
        await this.messagesColl.insertMany(this.messages);
      }
    } catch (err) {
      console.error('[PrivaMSG Mongo] MongoDB connection or data hydration failed:', err);
      console.warn('[PrivaMSG Mongo] Safely retaining default file storage fallback (KVDB.io + local).');
    }
  }

  private loadData() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const content = fs.readFileSync(this.usersFile, 'utf8').trim();
        this.users = content ? JSON.parse(content) : [];
      } else {
        this.users = [];
        this.saveUsersLocally();
      }

      if (fs.existsSync(this.messageFile)) {
        const content = fs.readFileSync(this.messageFile, 'utf8').trim();
        const encryptedMsgs: (Message & { encryptedContent?: string })[] = content ? JSON.parse(content) : [];
        this.messages = encryptedMsgs.map(msg => {
          const decrypted = msg.encrypted ? decryptText(msg.content) : msg.content;
          return {
            ...msg,
            content: decrypted,
            encrypted: true,
            encryptedContent: msg.encrypted ? msg.content : msg.encryptedContent
          } as Message;
        });
      } else {
        this.messages = [];
        this.saveMessagesLocally();
      }
    } catch (err) {
      console.log('[PrivaMSG DB] Initializing local storage files. Re-syncing from cloud databases...');
      this.users = [];
      this.messages = [];
    }
  }

  private saveUsersLocally() {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save users locally:', err);
    }
  }

  private saveUsers() {
    this.saveUsersLocally();

    if (this.mongoConnected && this.usersColl) {
      const ops = this.users.map(u => ({
        replaceOne: {
          filter: { id: u.id },
          replacement: u,
          upsert: true
        }
      }));
      if (ops.length > 0) {
        this.usersColl.bulkWrite(ops).then(res => {
          console.log(`[PrivaMSG Mongo] Users synced: ${res.modifiedCount} modified, ${res.upsertedCount} upserted.`);
        }).catch(err => {
          console.error('[PrivaMSG Mongo] Bulk write users error:', err);
        });
      }
      return;
    }

    // Fire-and-forget background cloud backup using ultra-stable KVDB.io as fallback
    try {
      const encryptedUsers = encryptText(JSON.stringify(this.users));
      fetch(`https://kvdb.io/${this.bucketId}/users`, {
        method: 'POST',
        body: encryptedUsers,
        headers: { 'Content-Type': 'text/plain' }
      }).then(res => {
        if (!res.ok) {
          console.warn('[PrivaMSG CloudSync] Background users backup failed with status:', res.status);
        } else {
          console.log('[PrivaMSG CloudSync] Background users backup completed successfully.');
        }
      }).catch(err => {
        console.error('[PrivaMSG CloudSync] Background users backup error:', err);
      });
    } catch (e) {
      console.error('[PrivaMSG CloudSync] Failed to fire users backup:', e);
    }
  }

  private saveMessagesLocally() {
    try {
      // Create copy of messages with encrypted content for disk storage
      const messagesToSave = this.messages.map(msg => {
        const encContent = (msg as any).encryptedContent || encryptText(msg.content);
        (msg as any).encryptedContent = encContent;
        return {
          id: msg.id,
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          content: encContent,
          timestamp: msg.timestamp,
          status: msg.status,
          encrypted: true
        };
      });
      fs.writeFileSync(this.messageFile, JSON.stringify(messagesToSave, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save messages locally:', err);
    }
  }

  private saveMessages() {
    this.saveMessagesLocally();

    if (this.mongoConnected && this.messagesColl) {
      const ops = this.messages.map(msg => ({
        replaceOne: {
          filter: { id: msg.id },
          replacement: msg,
          upsert: true
        }
      }));
      if (ops.length > 0) {
        this.messagesColl.bulkWrite(ops).then(res => {
          console.log(`[PrivaMSG Mongo] Messages synced: ${res.modifiedCount} modified, ${res.upsertedCount} upserted.`);
        }).catch(err => {
          console.error('[PrivaMSG Mongo] Bulk write messages error:', err);
        });
      }
      return;
    }

    // Fire-and-forget background cloud backup using ultra-stable KVDB.io as fallback
    try {
      const encryptedMessagesList = this.messages.map(msg => {
        const encContent = (msg as any).encryptedContent || encryptText(msg.content);
        (msg as any).encryptedContent = encContent;
        return {
          id: msg.id,
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          content: encContent,
          timestamp: msg.timestamp,
          status: msg.status,
          encrypted: true
        };
      });
      const payload = encryptText(JSON.stringify(encryptedMessagesList));
      fetch(`https://kvdb.io/${this.bucketId}/messages`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'text/plain' }
      }).then(res => {
        if (!res.ok) {
          console.warn('[PrivaMSG CloudSync] Background messages backup status err:', res.status);
        } else {
          console.log('[PrivaMSG CloudSync] Background messages backup completed.');
        }
      }).catch(err => {
        console.error('[PrivaMSG CloudSync] Background messages backup error:', err);
      });
    } catch (e) {
      console.error('[PrivaMSG CloudSync] Failed to fire messages backup:', e);
    }
  }

  public async initCloudSync() {
    if (this.connectPromise) {
      try {
        await this.connectPromise;
      } catch (err) {
        // Suppress, as it is already handled and logged in connectMongo
      }
    }

    if (this.mongoConnected) {
      console.log('[PrivaMSG CloudSync] MongoDB Atlas connected successfully. Bypassing legacy peer KVDB.io recovery to ensure cluster consistency.');
      return;
    }

    if (process.env.MONGODB_URI) {
      console.log('[PrivaMSG CloudSync] MONGODB_URI was configured but connection failed. Activating KVDB.io safe fallback to restore data.');
    }
    try {
      await this.getOrInitializeBucketId();
      console.log('[PrivaMSG CloudSync] Initializing persistent data recovery from key-value cloud store with bucket ID:', this.bucketId);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // 1. Recover Users
      try {
        const usersResponse = await fetch(`https://kvdb.io/${this.bucketId}/users`, { signal: controller.signal });
        if (usersResponse.ok) {
          const encryptedUsers = await usersResponse.text();
          if (encryptedUsers && encryptedUsers.trim() !== "") {
            try {
              const decryptedString = decryptText(encryptedUsers);
              const parsedUsers = JSON.parse(decryptedString);
              if (Array.isArray(parsedUsers)) {
                this.users = parsedUsers;
                this.saveUsersLocally();
                console.log(`[PrivaMSG CloudSync] Successfully restored ${this.users.length} users from cloud database.`);
              }
            } catch (e) {
              console.error('[PrivaMSG CloudSync] Failed to parse recovered users list:', e);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn('[PrivaMSG CloudSync] Users recovery request timed out.');
        } else {
          console.error('[PrivaMSG CloudSync] Error fetching cloud users:', err);
        }
      }

      // 2. Recover Messages
      try {
        const messagesResponse = await fetch(`https://kvdb.io/${this.bucketId}/messages`, { signal: controller.signal });
        if (messagesResponse.ok) {
          const encryptedMessages = await messagesResponse.text();
          if (encryptedMessages && encryptedMessages.trim() !== "") {
            try {
              const decryptedString = decryptText(encryptedMessages);
              const parsedMessages = JSON.parse(decryptedString);
              if (Array.isArray(parsedMessages)) {
                this.messages = parsedMessages.map(msg => ({
                  ...msg,
                  content: msg.encrypted ? decryptText(msg.content) : msg.content,
                  encrypted: true
                }));
                this.saveMessagesLocally();
                console.log(`[PrivaMSG CloudSync] Successfully restored ${this.messages.length} messages from cloud database.`);
              }
            } catch (e) {
              console.error('[PrivaMSG CloudSync] Failed to parse recovered messages list:', e);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn('[PrivaMSG CloudSync] Messages recovery request timed out.');
        } else {
          console.error('[PrivaMSG CloudSync] Error fetching cloud messages:', err);
        }
      }

      clearTimeout(timeoutId);
    } catch (err) {
      console.warn('[PrivaMSG CloudSync] Cloud synchronization failed. Defaulting to local memory/files.', err);
    }
  }

  // --- Auth & User Operations ---

  public registerUser(email: string, username: string, passwordString: string): { success: boolean; user?: User; securityBackup?: { passwordHash: string; salt: string }; error?: string } {
    const normalizedEmail = email.toLowerCase().trim();
    const cleanUsername = username.trim();

    if (!normalizedEmail || !cleanUsername || !passwordString) {
      return { success: false, error: 'All fields are required.' };
    }

    if (this.users.some(u => !u.isGroup && u.email === normalizedEmail)) {
      return { success: false, error: 'Email already registered.' };
    }

    if (this.users.some(u => !u.isGroup && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
      return { success: false, error: 'Username is taken.' };
    }

    const salt = crypto.randomBytes(32).toString('hex');
    const passwordHash = crypto.pbkdf2Sync(passwordString, salt, 1000, 64, 'sha512').toString('hex');

    // Create avatar placeholder with customized gradient seed
    const hash = crypto.createHash('md5').update(normalizedEmail).digest('hex');
    const colors = ['from-teal-400 to-emerald-500', 'from-blue-500 to-indigo-600', 'from-purple-500 to-pink-500', 'from-rose-500 to-orange-400', 'from-neutral-700 to-neutral-900'];
    const idx = parseInt(hash.substring(0, 2), 16) % colors.length;
    const avatar = colors[idx];

    const newUser: DBUser = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      username: cleanUsername,
      avatar: avatar,
      status: 'Hey there! I am using PrivaMSG.',
      online: false,
      contacts: [],
      passwordHash,
      salt
    };

    this.users.push(newUser);
    this.saveUsers();

    // Remove hashed credentials on output representation
    const { passwordHash: _, salt: __, ...publicUser } = newUser;
    return { 
      success: true, 
      user: publicUser,
      securityBackup: { passwordHash, salt }
    };
  }

  public loginUser(emailOrUsername: string, passwordString: string): { success: boolean; user?: User; securityBackup?: { passwordHash: string; salt: string }; error?: string } {
    const query = emailOrUsername.toLowerCase().trim();
    const dbUser = this.users.find(u => !u.isGroup && (u.email === query || u.username.toLowerCase() === query));

    if (!dbUser) {
      return { success: false, error: 'Incorrect email or password.' };
    }

    const verificationHash = crypto.pbkdf2Sync(passwordString, dbUser.salt, 1000, 64, 'sha512').toString('hex');

    if (verificationHash !== dbUser.passwordHash) {
      return { success: false, error: 'Incorrect email or password.' };
    }

    const { passwordHash: _, salt: __, ...publicUser } = dbUser;
    return { 
      success: true, 
      user: publicUser,
      securityBackup: { passwordHash: dbUser.passwordHash, salt: dbUser.salt }
    };
  }

  public updateUserProfile(userId: string, username: string, status: string, avatar: string): { success: boolean; user?: User; error?: string } {
    const uIndex = this.users.findIndex(u => u.id === userId);
    if (uIndex === -1) {
      return { success: false, error: 'User not found.' };
    }

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return { success: false, error: 'Username cannot be empty.' };
    }

    // Check if new username is taken by any OTHER registered user (excluding groups)
    if (this.users.some((u, idx) => idx !== uIndex && !u.isGroup && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
      return { success: false, error: 'Username is already taken.' };
    }

    this.users[uIndex].username = cleanUsername;
    this.users[uIndex].status = status;
    this.users[uIndex].avatar = avatar;

    this.saveUsers();

    const { passwordHash: _, salt: __, ...publicUser } = this.users[uIndex];
    return { success: true, user: publicUser };
  }

  public createGroup(name: string, description: string, creatorId: string, memberIds: string[]): { success: boolean; group?: User; error?: string } {
    const cleanName = name.trim();
    if (!cleanName) {
      return { success: false, error: 'Group name is required.' };
    }

    const uniqueMembers = Array.from(new Set([creatorId, ...memberIds]));
    const newGroup: DBUser = {
      id: crypto.randomUUID(),
      email: `group-${crypto.randomUUID()}@privamsg.internal`,
      username: cleanName,
      avatar: 'from-emerald-600 to-teal-500', // Beautiful prebuilt gradient for groups
      status: description.trim() || 'A secure encrypted group chat room.',
      online: true, // Show Group as active/online
      contacts: uniqueMembers, // Store members directly inside contacts
      isGroup: true,
      creatorId,
      passwordHash: '',
      salt: ''
    };

    this.users.push(newGroup);
    this.saveUsers();

    const { passwordHash: _, salt: __, ...publicGroup } = newGroup;
    return { success: true, group: publicGroup };
  }

  public restoreUser(userObject: DBUser): boolean {
    const idx = this.users.findIndex(u => u.id === userObject.id || u.email === userObject.email.toLowerCase().trim());
    if (idx !== -1) {
      // User already exists, update properties just in case
      this.users[idx] = {
        ...this.users[idx],
        username: userObject.username.trim(),
        avatar: userObject.avatar,
        status: userObject.status,
        contacts: Array.from(new Set([...this.users[idx].contacts, ...userObject.contacts]))
      };
      this.saveUsers();
      return true;
    }
    
    this.users.push({
      ...userObject,
      email: userObject.email.toLowerCase().trim()
    });
    this.saveUsers();
    return true;
  }

  public restoreMessages(messagesList: Message[]): number {
    let addedCount = 0;
    for (const msg of messagesList) {
      if (!this.messages.some(m => m.id === msg.id)) {
        const processedContent = this.processAndSaveAttachment(msg.id, msg.content);
        const encryptedContent = (msg as any).encryptedContent || encryptText(processedContent);
        
        const restoredMsg = {
          ...msg,
          content: processedContent,
          encryptedContent: encryptedContent,
          encrypted: true
        };
        this.messages.push(restoredMsg);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      this.saveMessages();
    }
    return addedCount;
  }

  public getUserById(id: string): User | undefined {
    const dbUser = this.users.find(u => u.id === id);
    if (!dbUser) return undefined;
    const { passwordHash: _, salt: __, ...publicUser } = dbUser;
    return publicUser;
  }

  public getUserList(): User[] {
    return this.users.map(u => {
      const { passwordHash: _, salt: __, ...publicUser } = u;
      return publicUser;
    });
  }

  public setOnlineStatus(userId: string, online: boolean) {
    const userIndex = this.users.findIndex(u => u.id === userId);
    if (userIndex !== -1) {
      this.users[userIndex].online = online;
      if (!online) {
        this.users[userIndex].lastSeen = new Date().toISOString();
      }
      this.saveUsers();
    }
  }

  // --- Contacts Operations ---

  public addContact(userId: string, contactEmailOrUsername: string): { success: boolean; contact?: User; error?: string } {
    const user = this.users.find(u => u.id === userId);
    if (!user) {
      return { success: false, error: 'User context not found.' };
    }

    const query = contactEmailOrUsername.toLowerCase().trim();
    if (!query) {
      return { success: false, error: 'Please enter an email or username.' };
    }

    // Find candidate contact
    const candidate = this.users.find(
      u => u.email === query || u.username.toLowerCase() === query
    );

    if (!candidate) {
      return { success: false, error: 'User not found. Ensure they registered with this email or username.' };
    }

    if (candidate.id === userId) {
      return { success: false, error: "You cannot add yourself as a contact." };
    }

    if (user.contacts.includes(candidate.id)) {
      return { success: false, error: 'User is already in your contacts.' };
    }

    // Bidirectional contacts add is best for instant mutual messaging like standard WhatsApp
    user.contacts.push(candidate.id);
    if (!candidate.contacts.includes(userId)) {
      candidate.contacts.push(userId);
    }

    this.saveUsers();

    const { passwordHash: _, salt: __, ...publicContact } = candidate;
    return { success: true, contact: publicContact };
  }

  public getContacts(userId: string): User[] {
    const user = this.users.find(u => u.id === userId);
    if (!user) return [];

    const personalContacts = user.contacts
      .map(cid => this.getUserById(cid))
      .filter((u): u is User => !!u);

    // Find all groups where this user is a member
    const userGroups = this.users.filter(u => u.isGroup && u.contacts.includes(userId));

    return [...personalContacts, ...userGroups];
  }

  public removeContact(userId: string, contactId: string): { success: boolean; error?: string } {
    const user = this.users.find(u => u.id === userId);
    if (!user) {
      return { success: false, error: 'User context not found.' };
    }

    const contact = this.users.find(u => u.id === contactId);
    if (!contact) {
      return { success: false, error: 'Contact not found.' };
    }

    if (contact.isGroup) {
      // Leave group
      contact.contacts = contact.contacts.filter(id => id !== userId);
      this.saveUsers();
      return { success: true };
    }

    // Unidirectional/Bidirectional contact remove.
    // Ensure the contact is removed from the current user's contact list.
    user.contacts = user.contacts.filter(id => id !== contactId);
    // Also remove bidirectionally so both users don't see each other as active contacts anymore
    contact.contacts = contact.contacts.filter(id => id !== userId);
    
    this.saveUsers();
    return { success: true };
  }

  // --- Messages Operations ---

  public getMessages(userId1: string, userId2: string): Message[] {
    const user2 = this.getUserById(userId2);
    let conversations: Message[] = [];
    if (user2 && user2.isGroup) {
      // For groups, return all messages sent to that group
      conversations = this.messages.filter(msg => msg.receiverId === userId2);
    } else {
      // For regular users, standard private messaging filtering
      conversations = this.messages.filter(
        msg =>
          (msg.senderId === userId1 && msg.receiverId === userId2) ||
          (msg.senderId === userId2 && msg.receiverId === userId1)
      );
    }
    // Filter out messages deleted for userId1
    return conversations
      .filter(msg => !msg.deletedForUsers || !msg.deletedForUsers.includes(userId1))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  public sendMessage(senderId: string, receiverId: string, content: string, customId?: string): Message {
    const msgId = customId || crypto.randomUUID();
    const processedContent = this.processAndSaveAttachment(msgId, content);
    const encryptedVal = encryptText(processedContent);
    const newMessage: Message & { encryptedContent?: string } = {
      id: msgId,
      senderId,
      receiverId,
      content: processedContent,
      timestamp: new Date().toISOString(),
      status: 'sent',
      encrypted: true,
      encryptedContent: encryptedVal
    };

    this.messages.push(newMessage);
    this.saveMessages();
    return newMessage;
  }

  public updateMessageStatus(messageId: string, status: 'delivered' | 'read'): boolean {
    const index = this.messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      this.messages[index].status = status;
      this.saveMessages();
      return true;
    }
    return false;
  }

  public deleteMessage(messageId: string): boolean {
    const index = this.messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      this.messages.splice(index, 1);
      this.saveMessagesLocally();
      
      if (this.mongoConnected && this.messagesColl) {
        this.messagesColl.deleteOne({ id: messageId }).catch(err => {
          console.error('[PrivaMSG Mongo] Delete message error:', err);
        });
      } else {
        this.saveMessages();
      }
      return true;
    }
    return false;
  }

  public deleteMessageForYourself(messageId: string, userId: string): boolean {
    const index = this.messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      const msg = this.messages[index];
      if (!msg.deletedForUsers) {
        msg.deletedForUsers = [];
      }
      if (!msg.deletedForUsers.includes(userId)) {
        msg.deletedForUsers.push(userId);
      }
      this.saveMessagesLocally();
      
      if (this.mongoConnected && this.messagesColl) {
        this.messagesColl.replaceOne({ id: messageId }, msg, { upsert: true }).catch(err => {
          console.error('[PrivaMSG Mongo] Save message error:', err);
        });
      } else {
        this.saveMessages();
      }
      return true;
    }
    return false;
  }

  public isMongoActive(): boolean {
    return this.mongoConnected;
  }
}

export const db = new PrivateMessageDB();
export default db;
