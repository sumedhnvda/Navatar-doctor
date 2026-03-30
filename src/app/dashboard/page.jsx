"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { auth, db } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import {
  collection, query, where, onSnapshot, doc, getDoc, addDoc, getDocs,
  serverTimestamp, deleteDoc, updateDoc
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
  Monitor, Video, LogOut, Clock, User, Plus,
  Calendar as CalendarIcon, CheckCircle2, Bot, Star, Timer, History, Activity
} from "lucide-react";
import { format, isSameDay, parseISO, addDays } from "date-fns";
import clsx from "clsx";

export default function DashboardPage() {
  const { user, doctorProfile, loading } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(new Date());

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [loading, user, router]);

  // Hospital data
  const [expectedBotIds, setExpectedBotIds] = useState([]);
  const [hospitalName, setHospitalName] = useState("");
  const [liveNavatars, setLiveNavatars] = useState([]);

  // Bookings
  const [bookings, setBookings] = useState([]);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedBotForBooking, setSelectedBotForBooking] = useState("");
  const [startH12, setStartH12] = useState("09");
  const [startM, setStartM] = useState("00");
  const [startPeriod, setStartPeriod] = useState("AM");

  const [endH12, setEndH12] = useState("09");
  const [endM, setEndM] = useState("30");
  const [endPeriod, setEndPeriod] = useState("AM");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [visibleSessionLimit, setVisibleSessionLimit] = useState(5);

  const [totalPastBookings, setTotalPastBookings] = useState(0);
  const [totalUpcomingBookings, setTotalUpcomingBookings] = useState(0);
  const [totalBookingHours, setTotalBookingHours] = useState(0);
  const [nextBooking, setNextBooking] = useState(null);
  const [timeUntilNext, setTimeUntilNext] = useState("");

  useEffect(() => {
    let pastCount = 0;
    let pastMins = 0;
    let upcoming = null;
    let closestTime = Infinity;
    let upcomingCount = 0;

    const nowTime = new Date().getTime();

    bookings.forEach(b => {
      if (b.doctorId === doctorProfile?.id && b.status !== 'Cancelled') {
        const [sH, sM] = (b.start_time || "00:00").split(':').map(Number);
        const [eH, eM] = (b.end_time || "00:00").split(':').map(Number);
        
        const slotStart = new Date(b.date);
        if(!isNaN(slotStart.getTime())) {
          slotStart.setHours(sH, sM, 0, 0);
          const slotEnd = new Date(b.date);
          slotEnd.setHours(eH, eM, 0, 0);
          
          if (nowTime >= slotEnd.getTime() || b.status === 'Completed') {
            pastCount++;
            pastMins += (eH * 60 + eM) - (sH * 60 + sM);
          } else {
            upcomingCount++;
            const timeDiff = slotStart.getTime() - nowTime;
            if (timeDiff > 0 && timeDiff < closestTime) {
              closestTime = timeDiff;
              upcoming = b;
            }
          }
        }
      }
    });

    setTotalPastBookings(pastCount);
    setTotalUpcomingBookings(upcomingCount);
    setTotalBookingHours((pastMins / 60).toFixed(1));
    setNextBooking(upcoming);
  }, [bookings, doctorProfile]);

  useEffect(() => {
    if (!nextBooking) {
      setTimeUntilNext("");
      return;
    }

    const updateCountdown = () => {
      const [sH, sM] = nextBooking.start_time.split(':').map(Number);
      const slotStart = new Date(nextBooking.date);
      slotStart.setHours(sH, sM, 0, 0);

      const diff = slotStart.getTime() - new Date().getTime();
      if (diff <= 0) {
        setTimeUntilNext("Starting soon");
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / 1000 / 60) % 60);
      const s = Math.floor((diff / 1000) % 60);

      let timerStr = "";
      if (d > 0) timerStr += `${d}d `;
      if (h > 0 || d > 0) timerStr += `${h}h `;
      timerStr += `${m}m ${s}s`;
      setTimeUntilNext(timerStr);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextBooking]);

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [completedBookingId, setCompletedBookingId] = useState(null);
  const [completedBotId, setCompletedBotId] = useState(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [rating, setRating] = useState(0); // 1 to 5 stars
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const SKIP_FEEDBACK_KEY = 'skipFeedbackUntil';

  useEffect(() => {
    // Check if we returned from a completed call that wants feedback overlay
    const search = window.location.search;
    if (search.includes("showFeedback=true")) {
      const params = new URLSearchParams(search);
      setShowFeedbackModal(true);
      setCompletedBookingId(params.get("completedBookingId"));
      setCompletedBotId(params.get("completedBotId"));
      router.replace('/dashboard');
    }
  }, [router]);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
  const maxDate = addDays(today, 7);

  // Fetch hospital data
  useEffect(() => {
    if (!doctorProfile || !doctorProfile.hospitalId) return;
    const fetchHospital = async () => {
      try {
        const hDoc = await getDoc(doc(db, "hospitals", doctorProfile.hospitalId));
        if (hDoc.exists()) {
          const data = hDoc.data();
          setExpectedBotIds(data.botIds || []);
          setHospitalName(data.hospitalName || "Hospital");
          if (data.botIds?.length > 0) setSelectedBotForBooking(data.botIds[0]);
        }
      } catch (err) {
        console.error("Error fetching hospital:", err);
      }
    };
    fetchHospital();
  }, [doctorProfile]);

  // Live navatars
  useEffect(() => {
    if (!doctorProfile || !doctorProfile.hospitalId) return;
    const q = query(collection(db, "navatars"), where("hospitalId", "==", doctorProfile.hospitalId));
    const unsub = onSnapshot(q, (snap) => {
      setLiveNavatars(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [doctorProfile]);

  // Fetch bookings for this hospital
  useEffect(() => {
    if (!doctorProfile || !doctorProfile.hospitalId) return;
    const q = query(collection(db, "bookings"), where("hospitalId", "==", doctorProfile.hospitalId));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [doctorProfile]);

  // Re-render every 60s for "Join" button timing
  useEffect(() => {
    const interval = setInterval(() => setBookings(b => [...b]), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try { await signOut(auth); } catch (e) {}
    router.push("/");
  };

  // Time helpers
  const isToday = date && isSameDay(date, now);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const handleCancelBooking = async (bookingId) => {
    if (window.confirm("Are you sure you want to cancel this booking? This action cannot be undone.")) {
      try {
        await updateDoc(doc(db, "bookings", bookingId), {
          status: "Cancelled"
        });
      } catch (err) {
        console.error("Error canceling booking:", err);
        setErrorMsg("Failed to cancel booking.");
      }
    }
  };

  const formatTo12H = (time24) => {
    if (!time24) return "";
    const [h, m] = time24.split(':');
    let hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12; // its 12 if 0
    return `${hour.toString().padStart(2, '0')}:${m} ${ampm}`;
  };

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    setErrorMsg(""); setSuccessMsg(""); setIsSubmitting(true);

    if (!selectedBotForBooking || !date || !user || !doctorProfile || doctorProfile.status !== 'active') {
      setErrorMsg("Please select a bot and date before booking."); setIsSubmitting(false); return;
    }

    // Block past dates
    const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (selectedDate < today) {
      setErrorMsg("Cannot book for a past date."); setIsSubmitting(false); return;
    }

    const get24H = (h12, per) => {
      let h = parseInt(h12, 10);
      if (per === "PM" && h !== 12) h += 12;
      if (per === "AM" && h === 12) h = 0;
      return h.toString().padStart(2, '0');
    };

    const startTime = `${get24H(startH12, startPeriod)}:${startM.padStart(2, '0')}`;
    const endTime = `${get24H(endH12, endPeriod)}:${endM.padStart(2, '0')}`;

    if (startTime >= endTime) { setErrorMsg("End time must be after start time."); setIsSubmitting(false); return; }

    // Enforce NO PAST TIMES if selected date is today
    if (isToday) {
      const [sH, sM] = startTime.split(':').map(Number);
      if (sH < currentHour || (sH === currentHour && sM < currentMinute)) {
        setErrorMsg("Cannot book in the past for today's date.");
        setIsSubmitting(false); return;
      }
    }

    // Check conflict: same bot, same date, overlapping time
    const dateStr = format(date, 'yyyy-MM-dd');
    const conflict = bookings.find(b =>
      b.botId === selectedBotForBooking &&
      b.date === dateStr &&
      b.status !== 'Completed' &&
      b.status !== 'Cancelled' &&
      !(endTime <= b.start_time.slice(0, 5) || startTime >= b.end_time.slice(0, 5))
    );
    if (conflict) {
      setErrorMsg(`This bot is already booked from ${conflict.start_time.slice(0,5)} to ${conflict.end_time.slice(0,5)} on this date.`);
      setIsSubmitting(false); return;
    }

    const payload = {
      date: dateStr,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      botId: selectedBotForBooking,
      doctorId: doctorProfile.id,
      doctorName: doctorProfile.name || user.email,
      hospitalId: doctorProfile.hospitalId,
      status: "Booked",
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, "bookings"), payload);
      setSuccessMsg("Booking created!");
      setTimeout(() => {
        setIsBookingDialogOpen(false); setSuccessMsg("");
        setStartH12("09"); setStartM("00"); setStartPeriod("AM");
        setEndH12("09"); setEndM("30"); setEndPeriod("AM");
      }, 1200);
    } catch (err) {
      console.error("Booking error:", err);
      setErrorMsg("Failed to create booking.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter bookings for selected date, sort descending (latest time at top)
  const filteredBookings = useMemo(() => {
    return bookings
      .filter(b => b.date && date && isSameDay(parseISO(b.date), date))
      .sort((a, b) => {
        // First try to sort by createdAt descending so newly created booking is at top
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        if (timeA !== timeB) return timeB - timeA;
        return b.start_time.localeCompare(a.start_time);
      });
  }, [bookings, date]);

  // Handle display limit of past + list items
  const displayableBookings = useMemo(() => {
    return filteredBookings.slice(0, visibleSessionLimit);
  }, [filteredBookings, visibleSessionLimit]);

  // Join logic: doctor can join 10 min before start and until end
  const canJoin = (booking) => {
    const current = new Date();
    const [sH, sM] = booking.start_time.split(':').map(Number);
    const [eH, eM] = booking.end_time.split(':').map(Number);
    const slotStart = new Date(booking.date); slotStart.setHours(sH, sM, 0, 0);
    const slotEnd = new Date(booking.date); slotEnd.setHours(eH, eM, 0, 0);
    const earlyJoin = new Date(slotStart.getTime() - 10 * 60 * 1000);
    return current >= earlyJoin && current < slotEnd && booking.status !== 'Completed';
  };

  const isCompleted = (booking) => {
    if (booking.status === 'Cancelled') return false; // Handle explicitly if needed, but lets just use logic
    const current = new Date();
    const [eH, eM] = booking.end_time.split(':').map(Number);
    const slotEnd = new Date(booking.date); slotEnd.setHours(eH, eM, 0, 0);
    return current >= slotEnd || booking.status === 'Completed';
  };

  const joinCall = (booking) => {
    router.push(`/call?botId=${booking.botId}&bookingId=${booking.id}`);
  };

  // ─── Feedback Handlers ───
  const handleFeedbackSubmit = async () => {
    if (rating === 0 && !feedbackText.trim()) return handleFeedbackSkip();
    setIsSubmittingFeedback(true);
    try {
      await addDoc(collection(db, "feedbacks"), {
        doctorId: doctorProfile?.id || user?.uid || "unknown",
        doctorName: doctorProfile?.name || user?.email || "Doctor",
        hospitalId: doctorProfile?.hospitalId || "unknown",
        bookingId: completedBookingId || null,
        botId: completedBotId || null,
        feedback: feedbackText,
        rating: rating,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error submitting feedback:", err);
    }
    setShowFeedbackModal(false);
    setIsSubmittingFeedback(false);
    setFeedbackText("");
    setRating(0);
  };

  const handleFeedbackSkip = () => {
    setShowFeedbackModal(false);
    setFeedbackText("");
    setRating(0);
  };

  const handleFeedbackSkip7Days = () => {
    localStorage.setItem(SKIP_FEEDBACK_KEY, Date.now() + 7 * 24 * 60 * 60 * 1000);
    setShowFeedbackModal(false);
    setFeedbackText("");
    setRating(0);
  };

  if (loading || !doctorProfile) {
    return (
      <div className="flex bg-slate-50 items-center justify-center min-vh-100 h-screen w-full">
        <div className="animate-pulse text-blue-600 font-semibold text-lg flex items-center gap-2">
          <Monitor className="h-6 w-6 animate-bounce" /> Loading Navatar Dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-blue-700">
            <Monitor className="h-6 w-6" />
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">Navatar</span>
          </div>

          <div className="hidden lg:flex items-center gap-6 pl-6 border-l border-slate-200">
            <div className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-green-600" /> 
              <span className="text-slate-600 font-medium">Total Hrs Booked:</span> 
              <span className="font-bold text-slate-900">{totalBookingHours} hr</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CalendarIcon className="h-4 w-4 text-blue-600" />
              <span className="text-slate-600 font-medium">Upcoming Sessions:</span>
              <span className="font-bold text-slate-900">{totalUpcomingBookings}</span>
            </div>
            {nextBooking && (
              <div className="flex items-center gap-2 text-sm">
                <Timer className="h-4 w-4 text-amber-500" />
                <span className="text-slate-600 font-medium">Next Session In:</span>
                <span className="font-bold text-slate-900">{timeUntilNext}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/history')} className="flex text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100 mr-2 sm:mr-0">
            <History className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">History</span>
          </Button>
          <div className="text-sm font-medium text-slate-600 hidden md:flex items-center gap-2">
            <User className="h-4 w-4" /> {doctorProfile.name || user?.email} ({hospitalName})
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-red-600">
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Next Session Card */}
        {nextBooking && (
          <div className="lg:col-span-12">
            <Card className="border-slate-200 shadow-sm border-l-4 border-l-amber-500 flex flex-col justify-between">
              <CardHeader className="p-4 pb-2">
                <CardDescription className="text-slate-500 font-semibold flex items-center gap-2 mb-1">
                  <Timer className="h-4 w-4" /> Next Upcoming Session
                </CardDescription>
                <CardTitle className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-3">
                  <span className="text-amber-500 animate-pulse">{timeUntilNext}</span>
                </CardTitle>
              </CardHeader>
              <div className="px-4 pb-4 pt-0 text-sm text-slate-500 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                {format(new Date(nextBooking.date), "MMM do")} at {formatTo12H(nextBooking.start_time)} with {liveNavatars.find(n => n.id === nextBooking.botId)?.name || nextBooking.botId}
              </div>
            </Card>
          </div>
        )}

        {/* Calendar Section */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
              <CardTitle className="text-slate-800">Schedule</CardTitle>
              <CardDescription>Select a date up to 7 days ahead</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Calendar
                mode="single" selected={date} onSelect={setDate}
                fromDate={today} toDate={maxDate}
                disabled={[{ before: today }, { after: maxDate }]}
                className="p-3 w-full flex justify-center rounded-b-xl"
                classNames={{
                  day_selected: "bg-blue-600 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-600 focus:text-white",
                  day_today: "bg-slate-100 text-slate-900 font-bold",
                  day_disabled: "text-slate-300 opacity-50 cursor-not-allowed",
                }}
              />
            </CardContent>
            <CardFooter className="pt-4 border-t border-slate-100 block">
              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setIsBookingDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Book Navatar Session
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Bookings List */}
        <div className="lg:col-span-8">
          <Card className="h-full border-slate-200 shadow-sm flex flex-col">
            <CardHeader className="bg-white pb-4 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-slate-800 text-2xl font-bold">Sessions</CardTitle>
                  <CardDescription className="text-slate-500 mt-1 flex items-center gap-1">
                    <CalendarIcon className="h-4 w-4" />
                    {date ? format(date, "EEEE, MMMM do, yyyy") : "Select a date"}
                  </CardDescription>
                </div>
                <div className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-3 py-1.5 rounded-full text-sm self-start sm:self-auto">
                  {filteredBookings.length} {filteredBookings.length === 1 ? 'Session' : 'Sessions'}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 flex flex-col">
              <ScrollArea className="flex-1 max-h-[calc(100vh-320px)] rounded-b-xl">
                {filteredBookings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full min-h-[400px]">
                    <Clock className="h-12 w-12 mb-4 opacity-20" />
                    <p className="font-medium text-lg">No sessions scheduled</p>
                    <p className="text-sm mt-1">Click &quot;Book Navatar Session&quot; to reserve a time.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {displayableBookings.map((booking) => {
                      const completed = isCompleted(booking);
                      const joinable = canJoin(booking);
                      const botData = liveNavatars.find(n => n.id === booking.botId);
                      const isMyBooking = booking.doctorId === doctorProfile.id;

                      return (
                        <div key={booking.id} className={clsx(
                          "p-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between transition-colors hover:bg-slate-50",
                          joinable && isMyBooking ? "bg-blue-50/50" : ""
                        )}>
                          <div className="flex items-start gap-4">
                            <div className="min-w-[120px] text-center pt-1">
                              <p className="text-lg font-bold text-slate-800">{formatTo12H(booking.start_time)}</p>
                              <p className="text-xs text-slate-500">to {formatTo12H(booking.end_time)}</p>
                            </div>
                            <Separator orientation="vertical" className="h-12 hidden sm:block bg-slate-200" />
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                                <Bot className="h-4 w-4 text-blue-600" />
                                {botData?.name || booking.botId}
                              </h3>
                              <p className="text-sm text-slate-500 mt-1">
                                Dr. {booking.doctorName}
                              </p>
                              <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                                <span className={clsx(
                                  "inline-block w-2 h-2 rounded-full",
                                  booking.status === 'Cancelled' ? "bg-red-500" : completed ? "bg-slate-300" : joinable ? "bg-green-500 animate-pulse" : "bg-blue-400"
                                )} />
                                {booking.status === 'Cancelled' ? "Cancelled" : completed ? "Completed" : joinable ? "Active Now" : "Scheduled"}
                              </p>
                            </div>
                          </div>
                          <div className="sm:pl-4 mt-2 sm:mt-0 flex flex-col gap-2 w-full sm:w-auto">
                            {!completed && booking.status !== 'Cancelled' && isMyBooking && (
                              <Button
                                onClick={() => joinCall(booking)}
                                disabled={!joinable}
                                className={clsx(
                                  "w-full sm:w-auto transition-all",
                                  joinable
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200"
                                    : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                                )}
                                variant={joinable ? "default" : "outline"}
                              >
                                <Video className="h-4 w-4 mr-2" />
                                Join Call
                              </Button>
                            )}
                            {!completed && booking.status !== 'Cancelled' && isMyBooking && (
                              <Button
                                onClick={() => handleCancelBooking(booking.id)}
                                variant="outline"
                                className="w-full sm:w-auto text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                              >
                                Cancel Session
                              </Button>
                            )}
                            {!joinable && !completed && booking.status !== 'Cancelled' && isMyBooking && (
                              <span className="text-xs text-slate-400 text-center">Opens 10m before start</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
              {filteredBookings.length > visibleSessionLimit && (
                <div className="p-4 border-t border-slate-100 flex justify-center bg-white">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setVisibleSessionLimit(prev => prev + 5)}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    Load More
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Booking Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={setIsBookingDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Book Navatar Session</DialogTitle>
            <DialogDescription>
              Reserve a bot on {date && format(date, "MMMM do, yyyy")}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBooking} className="space-y-5 py-4">
            {/* Bot Selector */}
            <div className="space-y-2">
              <Label className="text-slate-600 font-bold">Select Bot</Label>
              <select
                className="flex h-10 w-full items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                value={selectedBotForBooking}
                onChange={(e) => setSelectedBotForBooking(e.target.value)}
              >
                {expectedBotIds.map(id => {
                  const botData = liveNavatars.find(n => n.id === id);
                  return <option key={id} value={id}>{botData?.name || id}</option>;
                })}
              </select>
            </div>

            {/* Start Time */}
            <div className="space-y-2">
              <Label className="text-slate-600 font-bold">Start Time</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <input type="number" min="1" max="12"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={startH12} 
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (!val) setStartH12("");
                      else if (parseInt(val, 10) <= 12) setStartH12(val.slice(-2));
                    }} 
                    onBlur={() => {
                      if (!startH12) setStartH12("09");
                      else setStartH12(startH12.padStart(2, '0'));
                    }}
                    placeholder="09" />
                  <span className="text-slate-400 font-bold text-lg">:</span>
                  <input type="number" min="0" max="59"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={startM} 
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (!val) setStartM("");
                      else if (parseInt(val, 10) <= 59) setStartM(val.slice(-2));
                    }} 
                    onBlur={() => {
                      if (!startM) setStartM("00");
                      else setStartM(startM.padStart(2, '0'));
                    }}
                    placeholder="00" />
                </div>
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                  value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>

            {/* Presets */}
            <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
               <Label className="text-slate-600 font-bold text-sm mb-1">Quick Add (Optional Preset)</Label>
               <div className="flex items-center gap-2 flex-wrap">
                 {[15, 20, 30].map(mins => (
                   <Button key={mins} type="button" variant="outline" size="sm" className="h-8 shadow-sm bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
                     onClick={() => {
                        let h = parseInt(startH12, 10);
                        if (startPeriod === "PM" && h !== 12) h += 12;
                        if (startPeriod === "AM" && h === 12) h = 0;
                        let m = parseInt(startM, 10);
                        
                        let totalMins = h * 60 + m + mins;
                        let newH = Math.floor(totalMins / 60) % 24;
                        let newM = totalMins % 60;
                        
                        let newPeriod = newH >= 12 ? "PM" : "AM";
                        let newH12 = newH % 12 || 12;
                        
                        setEndH12(newH12.toString().padStart(2, '0'));
                        setEndM(newM.toString().padStart(2, '0'));
                        setEndPeriod(newPeriod);
                     }}
                   >
                     +{mins} min
                   </Button>
                 ))}
                 <span className="text-xs text-slate-400 font-medium ml-2">Sets end time automatically</span>
               </div>
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label className="text-slate-600 font-bold">End Time</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <input type="number" min="1" max="12"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={endH12} 
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (!val) setEndH12("");
                      else if (parseInt(val, 10) <= 12) setEndH12(val.slice(-2));
                    }}
                    onBlur={() => {
                      if (!endH12) setEndH12("09");
                      else setEndH12(endH12.padStart(2, '0'));
                    }}
                    placeholder="09" />
                  <span className="text-slate-400 font-bold text-lg">:</span>
                  <input type="number" min="0" max="59"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={endM} 
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (!val) setEndM("");
                      else if (parseInt(val, 10) <= 59) setEndM(val.slice(-2));
                    }}
                    onBlur={() => {
                      if (!endM) setEndM("30");
                      else setEndM(endM.padStart(2, '0'));
                    }}
                    placeholder="30" />
                </div>
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                  value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>

            {errorMsg && <p className="text-sm text-red-500 font-medium bg-red-50 p-2 rounded-md border border-red-100">{errorMsg}</p>}
            {successMsg && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-green-700 font-medium text-sm">
                <CheckCircle2 className="h-4 w-4" /> {successMsg}
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsBookingDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isSubmitting ? "Saving..." : "Confirm Booking"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Post-Call Feedback Dialog */}
      <Dialog open={showFeedbackModal} onOpenChange={(open) => {
        if (!open) handleFeedbackSkip();
      }}>
        <DialogContent className="sm:max-w-[500px] text-slate-800 bg-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Session Ended</DialogTitle>
            <DialogDescription className="text-slate-500">
              How was your experience? Your feedback helps us improve the Navatar service.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-2 flex flex-col gap-3">
            <div className="flex items-center gap-1 justify-center py-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="focus:outline-none transition-transform hover:scale-110"
                >
                  <Star
                    className={clsx(
                      "h-8 w-8",
                      star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300 fill-none"
                    )}
                  />
                </button>
              ))}
            </div>

            <textarea
              className="w-full min-h-[120px] p-3 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Tell us what went well or what could be better... (Optional)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2 items-center justify-between">
            <button
              type="button"
              className="text-sm text-slate-500 hover:text-slate-800 underline underline-offset-4"
              onClick={handleFeedbackSkip7Days}
            >
              Don&apos;t show for next 7 days
            </button>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handleFeedbackSkip}>
                Skip
              </Button>
              <Button type="button" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white" disabled={isSubmittingFeedback} onClick={handleFeedbackSubmit}>
                {isSubmittingFeedback ? "Saving..." : "Submit Feedback"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
