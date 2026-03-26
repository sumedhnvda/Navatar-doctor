"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { db } from '../../lib/firebase';
import { doc, getDoc, updateDoc, increment, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LogOut, Monitor, Settings, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useAuth } from "@/components/AuthProvider";

function CallUI() {
  const { doctorProfile, user, loading } = useAuth();

  const router = useRouter();
  const searchParams = useSearchParams();
  const botId = searchParams.get('botId');
  const bookingId = searchParams.get('bookingId');

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [loading, user, router]);

  const [connectionStatus, setConnectionStatus] = useState('Ready (Bot Standby)');
  const [timeLeft, setTimeLeft] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });

  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState({});
  const clientRef = useRef(null);
  const localVideoRef = useRef(null);
  const localTracksRef = useRef(null);
  const containerRef = useRef(null);
  const isReleasingRef = useRef(false);
  const hasLeftRef = useRef(false);

  // ─── Cleanup: stop all local tracks ───
  const stopAllTracks = useCallback(() => {
    if (localTracksRef.current?.audio) {
      try { localTracksRef.current.audio.stop(); localTracksRef.current.audio.close(); } catch (e) {}
    }
    if (localTracksRef.current?.video) {
      try { localTracksRef.current.video.stop(); localTracksRef.current.video.close(); } catch (e) {}
    }
    localTracksRef.current = null;
    setLocalAudioTrack(null);
    setLocalVideoTrack(null);
  }, []);

  // ─── Release bot in DB ───
  const releaseBot = useCallback(async () => {
    if (!botId || isReleasingRef.current) return;
    isReleasingRef.current = true;
    try {
      const botRef = doc(db, 'navatars', botId);
      const snap = await getDoc(botRef);
      if (snap.exists()) {
        const data = snap.data();
        let secondsUsed = 0;
        if (data.sessionStartedAt) {
          secondsUsed = Math.floor((Date.now() - data.sessionStartedAt) / 1000);
        }

        // Add history record
        await addDoc(collection(db, "history"), {
          botId,
          doctorId: doctorProfile?.id || "unknown",
          doctorName: doctorProfile?.name || user?.email || "Doctor",
          hospitalId: doctorProfile?.hospitalId || "unknown",
          durationSeconds: secondsUsed,
          sessionStartedAt: data.sessionStartedAt ? new Date(data.sessionStartedAt) : null,
          sessionEndedAt: serverTimestamp(),
          bookingId: bookingId || null
        });

        await updateDoc(botRef, {
          status: 'Available',
          activeDoctorId: null,
          activeDoctorName: null,
          sessionStartedAt: null,
          totalSecondsUsed: increment(secondsUsed > 0 ? secondsUsed : 0),
          totalAccesses: increment(1)
        });
      }
    } catch (e) {
      console.error("Failed to release bot:", e);
    }
  }, [botId, bookingId, doctorProfile, user]);

  // ─── Mark booking completed ───
  const completeBooking = useCallback(async () => {
    if (!bookingId) return;
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'Completed' });
    } catch (e) {
      console.error("Failed to complete booking:", e);
    }
  }, [bookingId]);

  // ─── Full leave: tracks + agora + DB ───
  const leaveCall = useCallback(async () => {
    if (hasLeftRef.current) return;
    hasLeftRef.current = true;

    stopAllTracks();

    if (clientRef.current) {
      try { await clientRef.current.leave(); } catch (e) {}
      clientRef.current = null;
    }

    await releaseBot();
    await completeBooking();

    const SKIP_FEEDBACK_KEY = 'skipFeedbackUntil';
    const skipUntil = localStorage.getItem(SKIP_FEEDBACK_KEY);
    if (skipUntil && parseInt(skipUntil, 10) > Date.now()) {
      router.push('/dashboard');
    } else {
      router.push(`/dashboard?showFeedback=true&completedBookingId=${bookingId || ''}&completedBotId=${botId || ''}`);
    }
  }, [stopAllTracks, releaseBot, completeBooking, router, bookingId, botId]);

  // ─── Agora Connection ───
  useEffect(() => {
    if (!botId) return;
    const channelName = botId;

    let isMounted = true;

    const initAgora = async () => {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      client.on("user-published", async (user, mediaType) => {
        if (!isMounted) return;
        await client.subscribe(user, mediaType);
        if (!isMounted) return;
        setRemoteUsers(prev => ({ ...prev, [user.uid]: user }));
        if (mediaType === "video") {
          setTimeout(() => {
            const el = document.getElementById(`remote-video-${user.uid}`);
            if (el) user.videoTrack.play(el);
          }, 0);
        }
        if (mediaType === "audio") user.audioTrack.play();
      });

      client.on("user-left", (user) => {
        if (!isMounted) return;
        setRemoteUsers(prev => { const u = { ...prev }; delete u[user.uid]; return u; });
      });

      try {
        const response = await fetch(`/api/agora/token?channelName=${channelName}&uid=0`);
        const data = await response.json();
        if (!isMounted) { client.leave().catch(() => {}); return; }
        if (data.error) throw new Error(data.error);

        await client.join(data.appId, channelName, data.token, null);
        if (!isMounted) { client.leave().catch(() => {}); return; }
        setConnectionStatus(`Connected (${channelName})`);

        const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
        if (!isMounted) { 
          audioTrack.stop(); audioTrack.close(); 
          videoTrack.stop(); videoTrack.close(); 
          client.leave().catch(() => {}); 
          return; 
        }
        localTracksRef.current = { audio: audioTrack, video: videoTrack };
        setLocalAudioTrack(audioTrack);
        setLocalVideoTrack(videoTrack);
        await client.publish([audioTrack, videoTrack]);
        if (localVideoRef.current) videoTrack.play(localVideoRef.current);
      } catch (error) {
        if (isMounted) {
          console.error("Agora Error:", error);
          const isPermissionError = 
            error.code === 'PERMISSION_DENIED' || 
            error.message?.includes('NotAllowedError') ||
            error.message?.includes('Permission');
            
          setConnectionStatus(isPermissionError ? "Permission Denied (Camera/Mic)" : "Connection Failed");
        }
      }
    };

    initAgora();

    return () => {
      isMounted = false;
      // Cleanup on unmount — stop tracks aggressively
      stopAllTracks();
      if (clientRef.current) {
        clientRef.current.removeAllListeners();
        clientRef.current.leave().catch(() => {});
        clientRef.current = null;
      }
    };
  }, [botId, stopAllTracks]);

  // ─── BeforeUnload: stop camera + release bot ───
  useEffect(() => {
    const handleUnload = () => {
      stopAllTracks();
      // Use sendBeacon for reliable DB update on tab close
      if (botId) {
        // Can't do async Firestore on unload, but stopAllTracks kills camera
        // releaseBot is best-effort
        releaseBot();
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [botId, stopAllTracks, releaseBot]);

  // ─── Auto-close when time slot expires ───
  useEffect(() => {
    if (!bookingId) return;
    let checkInterval;

    const enforceTimeLimit = async () => {
      try {
        const bookingSnap = await getDoc(doc(db, 'bookings', bookingId));
        if (!bookingSnap.exists()) return;
        const data = bookingSnap.data();
        const endDate = new Date(`${data.date}T${data.end_time}`);

        checkInterval = setInterval(() => {
          const now = new Date();
          const diff = endDate - now;

          if (diff <= 0) {
            setConnectionStatus("Time's up! Disconnecting...");
            clearInterval(checkInterval);
            setTimeout(() => leaveCall(), 2000);
          } else {
            // Show remaining time
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            setTimeLeft(`${mins}m ${secs}s remaining`);
          }
        }, 1000);
      } catch (err) {
        console.error("Error checking time limit:", err);
      }
    };

    enforceTimeLimit();
    return () => clearInterval(checkInterval);
  }, [bookingId, leaveCall]);

  // ─── Engage bot when entering call ───
  useEffect(() => {
    if (!botId || !doctorProfile) return;
    const botRef = doc(db, 'navatars', botId);
    updateDoc(botRef, {
      status: 'Engaged',
      activeDoctorId: doctorProfile.id,
      activeDoctorName: doctorProfile.name || user?.email || "Doctor",
      sessionStartedAt: Date.now()
    }).catch(e => console.error("Failed to engage bot:", e));
  }, [botId, doctorProfile, user]);

  // ─── Mic/Camera toggles ───
  useEffect(() => { if (localAudioTrack) localAudioTrack.setEnabled(micOn); }, [micOn, localAudioTrack]);
  useEffect(() => { if (localVideoTrack) localVideoTrack.setEnabled(cameraOn); }, [cameraOn, localVideoTrack]);

  const sendCommand = (x, y) => {};

  const handleJoystickMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    let y = (rect.height / 2 - (e.clientY - rect.top)) / (rect.height / 2);
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    setJoystickPos({ x, y });
    sendCommand(x, y);
  };

  const handleJoystickEnd = () => { setJoystickPos({ x: 0, y: 0 }); sendCommand(0, 0); };

  if (loading || !doctorProfile) {
    return (
      <div className="h-screen w-full bg-slate-950 text-white flex items-center justify-center">
        <div className="animate-pulse text-blue-400 font-semibold text-lg flex items-center gap-2">
          <Monitor className="h-6 w-6 animate-bounce" /> Loading Call Interface...
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-slate-950 flex flex-col text-white">
      <div className="flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2 text-blue-400">
          <Monitor className="h-6 w-6" />
          <span className="font-bold">Navatar Telepresence</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm bg-slate-800 px-3 py-1 rounded-full">{connectionStatus}</span>
          {timeLeft && <span className="text-sm bg-orange-900/50 text-orange-300 px-3 py-1 rounded-full">{timeLeft}</span>}
          <span className="text-sm text-slate-400">Bot: {botId || 'N/A'}</span>
        </div>
        <Button variant="destructive" size="sm" onClick={leaveCall}>
          <LogOut className="h-4 w-4 mr-2" /> End Session
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
          {Object.keys(remoteUsers).length === 0 ? (
            <div className="text-center p-8 bg-slate-900/80 rounded-2xl border border-slate-800 max-w-md z-10">
              <Video className="h-16 w-16 mx-auto mb-4 text-slate-600 animate-pulse" />
              <h2 className="text-xl font-bold mb-2">Waiting for Bot...</h2>
              <p className="text-slate-400 text-sm">The bot has not published video yet.</p>
            </div>
          ) : (
            Object.values(remoteUsers).map(user => (
              <div key={user.uid} id={`remote-video-${user.uid}`} className="w-full h-full object-cover absolute inset-0" />
            ))
          )}

          <div className="absolute bottom-6 right-6 w-48 h-36 bg-slate-800 rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl z-20" ref={localVideoRef}>
            {!cameraOn && (
              <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-500">
                <VideoOff className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 bg-slate-900/90 p-4 rounded-full border border-slate-800 backdrop-blur-sm z-20 shadow-xl">
            <Button variant={micOn ? "secondary" : "destructive"} size="icon" className="rounded-full h-12 w-12" onClick={() => setMicOn(!micOn)}>
              {micOn ? <Mic /> : <MicOff />}
            </Button>
            <Button variant={cameraOn ? "secondary" : "destructive"} size="icon" className="rounded-full h-12 w-12" onClick={() => setCameraOn(!cameraOn)}>
              {cameraOn ? <Video /> : <VideoOff />}
            </Button>
          </div>
        </div>

        <div className="w-80 bg-slate-900 border-l border-slate-800 p-6 flex flex-col">
          <h3 className="font-semibold text-lg mb-6 flex items-center gap-2">
            <Settings className="h-5 w-5" /> Bot Controls
          </h3>
          <Card className="bg-slate-950 border-slate-800 flex-1 flex flex-col items-center justify-center">
            <CardContent className="p-0 flex flex-col items-center justify-center h-full w-full">
              <p className="text-slate-400 text-sm mb-8">Virtual Joystick</p>
              <div
                ref={containerRef}
                className="w-48 h-48 rounded-full bg-slate-800 border-4 border-slate-700 relative touch-none cursor-crosshair shadow-inner"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleJoystickMove(e); }}
                onPointerMove={(e) => { if (e.buttons > 0) handleJoystickMove(e); }}
                onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); handleJoystickEnd(); }}
                onPointerCancel={handleJoystickEnd}
              >
                <div className="w-16 h-16 rounded-full bg-blue-500 absolute top-1/2 left-1/2 shadow-lg transition-transform"
                  style={{ transform: `translate(calc(-50% + ${joystickPos.x * 60}px), calc(-50% + ${-joystickPos.y * 60}px))` }}
                />
              </div>
              <div className="mt-8 text-xs text-slate-500 text-center px-4">
                Drag inside the circle to move the bot.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-slate-950 text-white flex items-center justify-center">Loading...</div>}>
      <CallUI />
    </Suspense>
  );
}
