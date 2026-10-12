import express from "express";
import http from "http";
import { Server } from "socket.io";
import { verifyToken } from "@clerk/backend";
import User from "../models/user.model.js";
import { logger } from "./logger.js";

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";

const io = new Server(server, {
  cors: {
    origin: [allowedOrigin, "http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  },
});

/**
 * In-memory multi-socket registry:
 * userId (string) -> Set<socketId>
 */
const userSocketMap = new Map();

/**
 * Returns all active socket IDs for a given user.
 * @param {string} userId
 * @returns {Array<string>}
 */
export function getReceiverSocketIds(userId) {
  if (!userId) return [];
  const sockets = userSocketMap.get(String(userId));
  return sockets ? Array.from(sockets) : [];
}

/**
 * Backward compatibility: returns the first active socket ID for a user.
 * @param {string} userId
 * @returns {string|undefined}
 */
export function getReceiverSocketId(userId) {
  const sockets = getReceiverSocketIds(userId);
  return sockets.length > 0 ? sockets[0] : undefined;
}

/**
 * Socket.io authentication & handshake middleware.
 * Verifies Clerk session JWT if provided; derives trusted user ID from database.
 * Strictly prevents unauthenticated spoofing in production.
 */
export async function authenticateSocket(socket, next) {
  try {
    let token = socket.handshake.auth?.token;
    if (!token && socket.handshake.headers?.authorization) {
      const rawAuth = socket.handshake.headers.authorization;
      token = rawAuth.startsWith("Bearer ") ? rawAuth.slice(7) : rawAuth;
    }
    if (!token && socket.handshake.headers?.cookie) {
      const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)__session=([^;]+)/);
      if (match) token = match[1];
    }

    const secretKey = process.env.CLERK_SECRET_KEY;

    if (token && secretKey) {
      try {
        const verified = await verifyToken(token, { secretKey });
        if (verified && verified.sub) {
          socket.clerkUserId = verified.sub;
          const user = await User.findOne({ clerkId: verified.sub });
          if (user) {
            socket.userId = user._id.toString();
          }
        }
      } catch (tokenErr) {
        logger.warn("socket_auth_token_invalid", "Invalid socket auth token during handshake", {
          error: tokenErr.message,
        });
        if (process.env.NODE_ENV === "production") {
          return next(new Error("Authentication error: Invalid session token"));
        }
      }
    }

    // In production, reject connection if no authenticated user could be derived
    if (process.env.NODE_ENV === "production" && !socket.userId) {
      return next(new Error("Authentication error: Unauthorized connection"));
    }

    // Fallback for local development or test suites only when not in production
    if (!socket.userId) {
      const queryUserId = socket.handshake.query?.userId || socket.handshake.auth?.userId;
      socket.userId = queryUserId ? String(queryUserId) : null;
    }

    next();
  } catch (err) {
    logger.error("socket_middleware_error", "Error in socket middleware", { error: err.message });
    if (process.env.NODE_ENV === "production") {
      return next(new Error("Authentication error: Handshake error"));
    }
  }
}

io.use(authenticateSocket);

io.on("connection", (socket) => {
  const userId = socket.userId;

  if (userId) {
    const uKey = String(userId);
    if (!userSocketMap.has(uKey)) {
      userSocketMap.set(uKey, new Set());
    }
    userSocketMap.get(uKey).add(socket.id);

    // Join personal room for multi-tab message & receipt routing
    socket.join(`user:${uKey}`);

    logger.info("socket_connected", "Client socket connected", {
      userId: uKey,
      socketId: socket.id,
      totalSocketsForUser: userSocketMap.get(uKey).size,
    });
  }

  // Broadcast current active online user list
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  // ----------------------------------------------------
  // Ephemeral Typing Indicators (Phase 2 / Task 2.4)
  // ----------------------------------------------------
  socket.on("typing:start", ({ receiverId }) => {
    if (receiverId && userId) {
      io.to(`user:${receiverId}`).emit("typing:start", {
        senderId: userId,
      });
    }
  });

  socket.on("typing:stop", ({ receiverId }) => {
    if (receiverId && userId) {
      io.to(`user:${receiverId}`).emit("typing:stop", {
        senderId: userId,
      });
    }
  });

  // ----------------------------------------------------
  // Message Delivery & Read Receipts (Phase 2 / Task 2.2)
  // ----------------------------------------------------
  socket.on("message:delivered", ({ messageId, senderId }) => {
    if (senderId && messageId) {
      io.to(`user:${senderId}`).emit("message:delivered", {
        messageId,
        receiverId: userId,
        deliveredAt: new Date().toISOString(),
      });
    }
  });

  socket.on("message:read", ({ messageId, senderId }) => {
    if (senderId && messageId) {
      io.to(`user:${senderId}`).emit("message:read", {
        messageId,
        receiverId: userId,
        readAt: new Date().toISOString(),
      });
    }
  });

  // ----------------------------------------------------
  // WebRTC Audio/Video Call Signaling (Phase 6 / Feature 8)
  // ----------------------------------------------------
  socket.on("call:initiate", ({ receiverId, callType, offer }) => {
    if (receiverId && userId) {
      io.to(`user:${receiverId}`).emit("call:incoming", {
        callerId: userId,
        callType: callType || "audio",
        offer,
      });
    }
  });

  socket.on("call:answer", ({ callerId, answer }) => {
    if (callerId && userId) {
      io.to(`user:${callerId}`).emit("call:accepted", {
        receiverId: userId,
        answer,
      });
    }
  });

  socket.on("call:reject", ({ callerId }) => {
    if (callerId && userId) {
      io.to(`user:${callerId}`).emit("call:rejected", {
        receiverId: userId,
      });
    }
  });

  socket.on("call:ice-candidate", ({ targetUserId, candidate }) => {
    if (targetUserId && userId) {
      io.to(`user:${targetUserId}`).emit("call:ice-candidate", {
        fromUserId: userId,
        candidate,
      });
    }
  });

  socket.on("call:end", ({ targetUserId }) => {
    if (targetUserId && userId) {
      io.to(`user:${targetUserId}`).emit("call:ended", {
        fromUserId: userId,
      });
    }
  });

  // ----------------------------------------------------
  // Disconnect Handling (Phase 1 / Task 1.6)
  // ----------------------------------------------------
  socket.on("disconnect", () => {
    if (userId) {
      const uKey = String(userId);
      const userSockets = userSocketMap.get(uKey);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          userSocketMap.delete(uKey);
        }
      }

      logger.info("socket_disconnected", "Client socket disconnected", {
        userId: uKey,
        socketId: socket.id,
      });
    }

    // Broadcast updated online users
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
  });
});

export { app, server, io, userSocketMap };