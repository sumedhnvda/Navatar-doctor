"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { auth, db } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import {
  collection, query, where, onSnapshot, doc, getDoc, addDoc, getDocs,
  serverTimestamp
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
  Calendar as CalendarIcon, CheckCircle2, Bot
} from "lucide-react";
import { format, isSameDay, parseISO, addDays } from "date-fns";
import clsx from "clsx";

export default function DashboardPage() {
  const { user, doctorProfile, loading } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(new Date());

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

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    setErrorMsg(""); setSuccessMsg(""); setIsSubmitting(true);

    if (!selectedBotForBooking || !date || !user) {
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

  // Filter bookings for selected date
  const filteredBookings = useMemo(() => {
    return bookings
      .filter(b => b.date && date && isSameDay(parseISO(b.date), date))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [bookings, date]);

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
    const current = new Date();
    const [eH, eM] = booking.end_time.split(':').map(Number);
    const slotEnd = new Date(booking.date); slotEnd.setHours(eH, eM, 0, 0);
    return current >= slotEnd || booking.status === 'Completed';
  };

  const joinCall = (booking) => {
    router.push(`/call?botId=${booking.botId}&bookingId=${booking.id}`);
  };

  if (loading || !doctorProfile) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 text-blue-700">
          <Monitor className="h-6 w-6" />
          <span className="font-bold text-xl tracking-tight">Navatar Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-slate-600 hidden md:flex items-center gap-2">
            <User className="h-4 w-4" /> {doctorProfile.name || user?.email} ({hospitalName})
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-red-600">
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
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
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-[calc(100vh-280px)] rounded-b-xl">
                {filteredBookings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full min-h-[400px]">
                    <Clock className="h-12 w-12 mb-4 opacity-20" />
                    <p className="font-medium text-lg">No sessions scheduled</p>
                    <p className="text-sm mt-1">Click &quot;Book Navatar Session&quot; to reserve a time.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredBookings.map((booking) => {
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
                            <div className="min-w-[100px] text-center pt-1">
                              <p className="text-lg font-bold text-slate-800">{booking.start_time.slice(0, 5)}</p>
                              <p className="text-xs text-slate-500">to {booking.end_time.slice(0, 5)}</p>
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
                                  completed ? "bg-slate-300" : joinable ? "bg-green-500 animate-pulse" : "bg-blue-400"
                                )} />
                                {completed ? "Completed" : joinable ? "Active Now" : "Scheduled"}
                              </p>
                            </div>
                          </div>
                          <div className="sm:pl-4 mt-2 sm:mt-0 flex flex-col gap-2 w-full sm:w-auto">
                            {!completed && isMyBooking && (
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
                            {!joinable && !completed && isMyBooking && (
                              <span className="text-xs text-slate-400 text-center">Opens 10m before start</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
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
                    value={startH12} onChange={(e) => setStartH12(e.target.value)} placeholder="09" />
                  <span className="text-slate-400 font-bold text-lg">:</span>
                  <input type="number" min="0" max="59"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={startM} onChange={(e) => setStartM(e.target.value)} placeholder="00" />
                </div>
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                  value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label className="text-slate-600 font-bold">End Time</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <input type="number" min="1" max="12"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={endH12} onChange={(e) => setEndH12(e.target.value)} placeholder="09" />
                  <span className="text-slate-400 font-bold text-lg">:</span>
                  <input type="number" min="0" max="59"
                    className="h-10 w-14 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-600"
                    value={endM} onChange={(e) => setEndM(e.target.value)} placeholder="30" />
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
    </div>
  );
}
