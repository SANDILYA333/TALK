import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import { io } from "socket.io-client";
import { getOrCreateDeviceIdentity, getDeviceConnectId } from "../lib/crypto/identity";
import { bindDeviceIdentityWithBackend } from "../lib/api/identity";

const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:3000" : "/";

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isCheckingAuth: true,
  onlineUsers: [],
  socket: null,

  deviceConnectId: null,
  isDeviceBound: false,
  isBindingDevice: false,

  initDeviceIdentity: async () => {
    try {
      set({ isBindingDevice: true });
      // Step 1: Ensure local X25519 keypair and Connect ID are generated/loaded
      const identity = await getOrCreateDeviceIdentity();
      set({ deviceConnectId: identity.connectId });

      // Step 2: Perform automated cryptographic Proof-of-Possession binding with the backend
      const bindResult = await bindDeviceIdentityWithBackend();
      if (bindResult?.success) {
        set({ isDeviceBound: true, deviceConnectId: bindResult.connectId });
      }
    } catch (error) {
      console.error("Auto device identity binding error:", error);
      const localId = getDeviceConnectId();
      if (localId) {
        set({ deviceConnectId: localId });
      }
    } finally {
      set({ isBindingDevice: false });
    }
  },

  checkAuth: async () => {
    set({ isCheckingAuth: true });

    try {
      const res = await axiosInstance.get("/auth/check");
      set({ authUser: res.data });

      get().connectSocket(res.data);
      get().initDeviceIdentity();
    } catch (error) {
      console.error("Error in checkAuth:", error);
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  clearAuth: () => {
    set({
      authUser: null,
      isCheckingAuth: false,
      onlineUsers: [],
      deviceConnectId: null,
      isDeviceBound: false,
      isBindingDevice: false,
    });
    get().disconnectSocket();
  },

  connectSocket: (user) => {
    if (!user || get().socket?.connected) return;

    const socket = io(BASE_URL, { query: { userId: user._id } });

    set({ socket });

    socket.on("getOnlineUsers", (userIds) => {
      set({ onlineUsers: userIds });
    });
  },

  disconnectSocket: () => {
    const socket = get().socket;
    if (socket?.connected) socket.disconnect();
    set({ socket: null });
  },
}));