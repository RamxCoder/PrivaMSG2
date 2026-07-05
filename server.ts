import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import { WSEvent, Message, User } from './src/types';

async function startServer() {
  // Pull from cloud store in the background to avoid blocking critical server boot and port binding
  db.initCloudSync().catch((err) => {
    console.error('[PrivaMSG Server] Background failure in cloud sync:', err);
  });

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON parsing and cross-origin handling
  app.use(express.json());

  // API Authentication Endpoints
  app.post('/api/auth/register', (req, res) => {
    const { email, username, password } = req.body;
    const result = db.registerUser(email, username, password);
    if (result.success) {
      res.json({ success: true, user: result.user, securityBackup: result.securityBackup });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const result = db.loginUser(email, password);
    if (result.success) {
      res.json({ success: true, user: result.user, securityBackup: result.securityBackup });
    } else {
      res.status(401).json({ success: false, error: result.error });
    }
  });

  app.get('/api/users/:id', (req, res) => {
    const user = db.getUserById(req.params.id);
    if (user) {
      res.json({ success: true, user });
    } else {
      res.status(404).json({ success: false, error: 'User not found' });
    }
  });

  app.post('/api/profile/update', (req, res) => {
    const { userId, username, status, avatar } = req.body;
    const result = db.updateUserProfile(userId, username, status, avatar);
    if (result.success) {
      res.json({ success: true, user: result.user });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  app.post('/api/groups/create', (req, res) => {
    const { name, description, creatorId, memberIds } = req.body;
    const result = db.createGroup(name, description, creatorId, memberIds);
    if (result.success) {
      const newGroup = result.group;
      if (newGroup) {
        const creatorUser = db.getUserById(creatorId);
        const creatorName = creatorUser ? creatorUser.username : 'Owner';
        const systemMsg = db.sendMessage(creatorId, newGroup.id, `⚙️ Group "${name}" created by ${creatorName}! Securely invite colleagues and friends.`);
        const wsUpdate = JSON.stringify({
          type: 'message',
          message: systemMsg
        });
        const members = newGroup.contacts || [];
        for (const mId of members) {
          const sockets = connections.get(mId);
          if (sockets) {
            for (const s of sockets) {
              if (s.readyState === WebSocket.OPEN) {
                s.send(wsUpdate);
              }
            }
          }
        }
      }
      res.json({ success: true, group: result.group });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // Secure stateless server self-healing sync endpoints
  app.post('/api/sync/restore-user', (req, res) => {
    const { id, email, username, avatar, status, passwordHash, salt, contacts } = req.body;
    if (!id || !email || !username || !passwordHash || !salt) {
      return res.status(400).json({ success: false, error: 'Missing security and identity credentials block' });
    }
    const success = db.restoreUser({
      id,
      email,
      username,
      avatar,
      status,
      passwordHash,
      salt,
      contacts: contacts || [],
      online: false
    });
    res.json({ success });
  });

  app.post('/api/sync/restore-public-users', (req, res) => {
    const { users } = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ success: false, error: 'Expected users list array' });
    }
    let restoredCount = 0;
    for (const u of users) {
      if (u.id && u.email && u.username) {
        const passwordHash = u.passwordHash || 'mesh-placeholder';
        const salt = u.salt || 'mesh-placeholder';
        const success = db.restoreUser({
          id: u.id,
          email: u.email,
          username: u.username,
          avatar: u.avatar || '',
          status: u.status || 'Hey there! I am using PrivaMSG.',
          passwordHash,
          salt,
          contacts: u.contacts || [],
          online: false
        });
        if (success) restoredCount++;
      }
    }
    res.json({ success: true, restoredCount });
  });

  app.post('/api/sync/messages', (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Expected messages list array' });
    }
    const addedCount = db.restoreMessages(messages);
    res.json({ success: true, addedCount });
  });

  // Map to track active connections: userId -> Set of WebSockets (allowing multi-device/multi-tab sync)
  const connections = new Map<string, Set<WebSocket>>();

  const getActiveDevicesForUser = (userId: string): ('desktop' | 'mobile')[] => {
    const sockets = connections.get(userId);
    if (!sockets) return [];
    const devices = new Set<'desktop' | 'mobile'>();
    for (const socket of sockets) {
      devices.add((socket as any).deviceType || 'desktop');
    }
    return Array.from(devices);
  };

  // Contacts endpoints
  app.get('/api/contacts', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const contacts = db.getContacts(userId);
    const contactsWithDevices = contacts.map(c => ({
      ...c,
      devices: getActiveDevicesForUser(c.id)
    }));
    res.json({ success: true, contacts: contactsWithDevices });
  });

  app.get('/api/users', (req, res) => {
    const users = db.getUserList();
    res.json({ success: true, users });
  });

  app.post('/api/contacts/add', (req, res) => {
    const { userId, contactQuery } = req.body;
    const result = db.addContact(userId, contactQuery);
    if (result.success) {
      res.json({ success: true, contact: result.contact });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  app.post('/api/contacts/remove', (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) {
      return res.status(400).json({ error: 'userId and contactId are required' });
    }
    const result = db.removeContact(userId, contactId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // Message history retrieval
  app.get('/api/messages', (req, res) => {
    const { userId1, userId2 } = req.query;
    if (!userId1 || !userId2) {
      return res.status(400).json({ error: 'Both userId1 and userId2 are required' });
    }
    const history = db.getMessages(userId1 as string, userId2 as string);
    res.json({ success: true, messages: history });
  });

  // Media attachments serving
  app.get('/api/attachments/:id', async (req, res) => {
    try {
      const dataUrl = await db.getAttachment(req.params.id);
      if (!dataUrl) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const regex = /^data:([^;]+);base64,(.*)$/;
      const matches = dataUrl.match(regex);
      if (matches) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        return res.send(buffer);
      } else {
        // Fallback for raw or malformed data URL
        res.setHeader('Content-Type', 'text/plain');
        return res.send(dataUrl);
      }
    } catch (err) {
      console.error('Error serving attachment:', err);
      res.status(500).json({ error: 'Internal server error while retrieving media' });
    }
  });

  // Health check/Status Audit
  app.get('/api/db/audit', (req, res) => {
    res.json({
      status: 'Secured & Active',
      storeType: db.isMongoActive() ? 'Enterprise Cloud MongoDB Atlas' : 'Cryptographic JSON File Database',
      cipher: 'AES-256-CBC',
      keyHashing: 'PBKDF2-HMAC-SHA512',
      registeredUsers: db.getUserList().length
    });
  });

  // Set up HTTP server
  const server = http.createServer(app);

  // Set up WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentUserId: string | null = null;

    ws.on('message', (rawData) => {
      try {
        const payload: WSEvent = JSON.parse(rawData.toString());

        switch (payload.type) {
          case 'register': {
            currentUserId = payload.userId;
            (ws as any).deviceType = ('deviceType' in payload && payload.deviceType) || 'desktop';
            
            if (!connections.has(currentUserId)) {
              connections.set(currentUserId, new Set());
            }
            connections.get(currentUserId)!.add(ws);
            db.setOnlineStatus(currentUserId, true);

            // Broadcast presence to all other registered connections
            const presenceEvent = JSON.stringify({
              type: 'presence',
              userId: currentUserId,
              online: true,
              devices: getActiveDevicesForUser(currentUserId)
            });

            for (const [uid, clientSet] of connections.entries()) {
              if (uid !== currentUserId) {
                for (const client of clientSet) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(presenceEvent);
                  }
                }
              }
            }
            break;
          }

          case 'message': {
            const { message } = payload;

            // 1. Intercept Group messages
            const groupUser = db.getUserById(message.receiverId);
            if (groupUser && groupUser.isGroup) {
              const savedMessage = db.sendMessage(message.senderId, message.receiverId, message.content, message.id);
              const msgEvent = JSON.stringify({
                type: 'message',
                message: savedMessage
              });

              const membersList = groupUser.contacts || [];
              let isDeliveredToAny = false;

              for (const memberId of membersList) {
                if (memberId === message.senderId) continue;
                const memberSockets = connections.get(memberId);
                if (memberSockets) {
                  for (const mSocket of memberSockets) {
                    if (mSocket.readyState === WebSocket.OPEN) {
                      mSocket.send(msgEvent);
                      isDeliveredToAny = true;
                    }
                  }
                }
              }

              if (isDeliveredToAny) {
                db.updateMessageStatus(savedMessage.id, 'delivered');
                savedMessage.status = 'delivered';
              }

              // Sync message with creator's active multi-device tabs
              const senderSockets = connections.get(message.senderId);
              if (senderSockets) {
                const updatedMsgEvent = JSON.stringify({
                  type: 'message',
                  message: savedMessage
                });
                for (const client of senderSockets) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(updatedMsgEvent);
                  }
                }
              }

              break;
            }

            // 3. Fallback standard client private messaging
            // Persist the message in the secure DB
            const savedMessage = db.sendMessage(message.senderId, message.receiverId, message.content, message.id);

            const msgEvent = JSON.stringify({
              type: 'message',
              message: savedMessage
            });

            // Deliver to all active sockets of the recipient
            const recipientSockets = connections.get(message.receiverId);
            let isDelivered = false;

            if (recipientSockets && recipientSockets.size > 0) {
              for (const client of recipientSockets) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(msgEvent);
                  isDelivered = true;
                }
              }
            }

            if (isDelivered) {
              db.updateMessageStatus(savedMessage.id, 'delivered');
              savedMessage.status = 'delivered';
            }

            // Sync with all active sockets of the sender (including other devices/tabs)
            const senderSockets = connections.get(message.senderId);
            if (senderSockets && senderSockets.size > 0) {
              const updatedMsgEvent = JSON.stringify({
                type: 'message',
                message: savedMessage
              });
              for (const client of senderSockets) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(updatedMsgEvent);
                }
              }
            } else {
              // Fallback
              ws.send(msgEvent);
            }

            // Sync delivery status with sender's devices
            if (isDelivered) {
              const statusEvent = JSON.stringify({
                type: 'message_status',
                messageId: savedMessage.id,
                status: 'delivered'
              });
              if (senderSockets) {
                for (const client of senderSockets) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(statusEvent);
                  }
                }
              }
            }
            break;
          }

          case 'message_status': {
            const { messageId, status } = payload;
            db.updateMessageStatus(messageId, status);
            // Propagate event to all open connections
            const statusEvent = JSON.stringify({ type: 'message_status', messageId, status });
            for (const [uid, clientSet] of connections.entries()) {
              for (const client of clientSet) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(statusEvent);
                }
              }
            }
            break;
          }

          case 'typing': {
            const { senderId, receiverId, isTyping } = payload;
            const recipientSockets = connections.get(receiverId);
            if (recipientSockets) {
              const typingEvent = JSON.stringify({
                type: 'typing',
                senderId,
                receiverId,
                isTyping
              });
              for (const client of recipientSockets) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(typingEvent);
                }
              }
            }
            break;
          }

          case 'delete_message': {
            const { messageId, senderId, receiverId, everyone } = payload;
            const isEveryone = everyone !== false;

            if (isEveryone) {
              db.deleteMessage(messageId);
            } else {
              db.deleteMessageForYourself(messageId, senderId);
            }

            const deleteEvent = JSON.stringify({
              type: 'delete_message',
              messageId,
              senderId,
              receiverId,
              everyone: isEveryone,
              deletedForUsers: isEveryone ? [] : [senderId]
            });

            // Broadcast to recipient if deleting for everyone
            if (isEveryone) {
              const recipientSockets = connections.get(receiverId);
              if (recipientSockets) {
                for (const client of recipientSockets) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(deleteEvent);
                  }
                }
              }
            }

            // Always broadcast to sender's other sockets/devices
            const senderSockets = connections.get(senderId);
            if (senderSockets) {
              for (const client of senderSockets) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(deleteEvent);
                }
              }
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      if (currentUserId) {
        const userSockets = connections.get(currentUserId);
        if (userSockets) {
          userSockets.delete(ws);
          if (userSockets.size === 0) {
            connections.delete(currentUserId);
            db.setOnlineStatus(currentUserId, false);

            // Broadcast offline status to others
            const presenceEvent = JSON.stringify({
              type: 'presence',
              userId: currentUserId,
              online: false,
              devices: [],
              lastSeen: new Date().toISOString()
            });

            for (const [uid, clientSet] of connections.entries()) {
              if (uid !== currentUserId) {
                for (const client of clientSet) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(presenceEvent);
                  }
                }
              }
            }
          } else {
            // Still active on another device session
            const presenceEvent = JSON.stringify({
              type: 'presence',
              userId: currentUserId,
              online: true,
              devices: getActiveDevicesForUser(currentUserId)
            });

            for (const [uid, clientSet] of connections.entries()) {
              if (uid !== currentUserId) {
                for (const client of clientSet) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(presenceEvent);
                  }
                }
              }
            }
          }
        }
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket client connection error:', err);
    });
  });

  // Robustly determine if we are running in production/static serving mode.
  const isProduction = process.env.NODE_ENV === 'production' || 
                       (!process.argv.some(arg => arg.includes('server.ts'))) ||
                       (typeof __filename !== 'undefined' && (__filename.endsWith('.cjs') || __filename.includes('dist/')));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Robust, dynamic dist folder detection regardless of launch directory
    let distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      if (fs.existsSync(path.join(__dirname, 'index.html'))) {
        distPath = __dirname;
      } else if (fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
        distPath = path.join(__dirname, '..', 'dist');
      } else if (fs.existsSync(path.join(process.cwd(), 'index.html'))) {
        distPath = process.cwd();
      }
    }
    
    console.log(`[PrivaMSG Server] Serving production asset files from: ${distPath}`);
    app.use(express.static(distPath));
    // Support SPA router callback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[PrivaMSG Server] Running securely on port ${PORT}`);
  });
}

startServer();
