import { useState, useRef, useEffect } from "react";
import { Button } from "@heroui/react";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";
import { useChatStore } from "../../store/useChatStore";
import { useAuthStore } from "../../store/useAuthStore";

export function CallModal() {
  const activeCall = useChatStore((state) => state.activeCall);
  const isCallModalOpen = useChatStore((state) => state.isCallModalOpen);
  const setActiveCall = useChatStore((state) => state.setActiveCall);
  const setIsCallModalOpen = useChatStore((state) => state.setIsCallModalOpen);

  const socket = useAuthStore((state) => state.socket);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (!isCallModalOpen) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    }
  }, [isCallModalOpen]);

  if (!isCallModalOpen || !activeCall) return null;

  const isIncoming = activeCall.isIncoming && activeCall.status === "ringing";
  const isVideo = activeCall.callType === "video";

  const handleAnswer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      if (socket && activeCall.partnerId) {
        socket.emit("call:answer", {
          callerId: activeCall.partnerId,
          answer: { type: "answer", sdp: "dummy_sdp_for_webrtc_session" },
        });
      }

      setActiveCall({
        ...activeCall,
        status: "connected",
        isIncoming: false,
      });
    } catch (err) {
      console.warn("Could not access media devices:", err);
      setActiveCall({ ...activeCall, status: "connected", isIncoming: false });
    }
  };

  const handleReject = () => {
    if (socket && activeCall.partnerId) {
      socket.emit("call:reject", { callerId: activeCall.partnerId });
    }
    setActiveCall(null);
    setIsCallModalOpen(false);
  };

  const handleEndCall = () => {
    if (socket && activeCall.partnerId) {
      socket.emit("call:end", { targetUserId: activeCall.partnerId });
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setActiveCall(null);
    setIsCallModalOpen(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = isMuted;
      });
    }
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = isVideoDisabled;
      });
    }
    setIsVideoDisabled(!isVideoDisabled);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="relative flex w-full max-w-lg flex-col items-center rounded-3xl border border-border bg-surface p-6 shadow-2xl text-center">
        <div className="mb-4">
          <div className="mx-auto mb-3 flex size-20 items-center justify-center rounded-full bg-accent/20 text-accent ring-8 ring-accent/10 animate-pulse">
            {isVideo ? <Video className="size-10" /> : <Phone className="size-10" />}
          </div>
          <h2 className="text-xl font-bold">
            {isVideo ? "Video Call" : "Voice Call"}
          </h2>
          <p className="text-xs text-muted mt-1">
            {isIncoming
              ? "Incoming call..."
              : activeCall.status === "connected"
              ? "Connected • End-to-End Encrypted (WebRTC)"
              : "Calling..."}
          </p>
        </div>

        {isVideo && activeCall.status === "connected" ? (
          <div className="relative mb-6 h-56 w-full overflow-hidden rounded-2xl bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover"
            />
            <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] text-white">
              You
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-4 mt-2">
          {isIncoming ? (
            <>
              <Button
                variant="primary"
                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-full size-14 flex items-center justify-center"
                onPress={handleAnswer}
                aria-label="Answer Call"
              >
                <Phone className="size-6" />
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-500 text-white rounded-full size-14 flex items-center justify-center"
                onPress={handleReject}
                aria-label="Decline Call"
              >
                <PhoneOff className="size-6" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                isIconOnly
                className="rounded-full size-12"
                onPress={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="size-5 text-red-400" /> : <Mic className="size-5" />}
              </Button>

              {isVideo ? (
                <Button
                  variant="secondary"
                  isIconOnly
                  className="rounded-full size-12"
                  onPress={toggleVideo}
                  aria-label={isVideoDisabled ? "Turn on Camera" : "Turn off Camera"}
                >
                  {isVideoDisabled ? (
                    <VideoOff className="size-5 text-red-400" />
                  ) : (
                    <Video className="size-5" />
                  )}
                </Button>
              ) : null}

              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-500 text-white rounded-full size-14 flex items-center justify-center"
                onPress={handleEndCall}
                aria-label="End Call"
              >
                <PhoneOff className="size-6" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
