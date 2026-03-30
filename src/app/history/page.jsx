"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDoc, doc } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Monitor, User, Clock, Bot, LogOut, History, Search, Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function HistoryPage() {
  const { user, doctorProfile, loading } = useAuth();
  const router = useRouter();

  const [bookings, setBookings] = useState([]);
  const [liveNavatars, setLiveNavatars] = useState([]);
  const [hospitalName, setHospitalName] = useState("");
  
  const [dateFilter, setDateFilter] = useState("");
  const [navatarFilter, setNavatarFilter] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [loading, user, router]);

  // Fetch hospital data
  useEffect(() => {
    if (!doctorProfile || !doctorProfile.hospitalId) return;
    const fetchHospital = async () => {
      try {
        const hDoc = await getDoc(doc(db, "hospitals", doctorProfile.hospitalId));
        if (hDoc.exists()) {
          const data = hDoc.data();
          setHospitalName(data.hospitalName || "Hospital");
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

  // Fetch bookings for this doctor
  useEffect(() => {
    if (!doctorProfile || !doctorProfile.id) return;
    const q = query(collection(db, "bookings"), where("doctorId", "==", doctorProfile.id));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [doctorProfile]);

  const handleLogout = async () => {
    try { await signOut(auth); } catch (e) {}
    router.push("/");
  };

  const formatTo12H = (time24) => {
    if (!time24) return "";
    const [h, m] = time24.split(':');
    let hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12;
    return `${hour.toString().padStart(2, '0')}:${m} ${ampm}`;
  };

  // Filter and sort for PAST bookings
  const pastBookings = useMemo(() => {
    const nowTime = new Date().getTime();
    
    return bookings.filter(b => {
      if (b.status === 'Cancelled') return false;
      const [eH, eM] = (b.end_time || "00:00").split(':').map(Number);
      const slotEnd = new Date(b.date);
      if(isNaN(slotEnd.getTime())) return false;
      slotEnd.setHours(eH, eM, 0, 0);
      
      const isPast = (nowTime >= slotEnd.getTime() || b.status === 'Completed');
      if (!isPast) return false;

      // Filter by date
      if (dateFilter && b.date !== dateFilter) return false;

      // Filter by bot/navatar name
      if (navatarFilter) {
         const botData = liveNavatars.find(n => n.id === b.botId);
         const botName = (botData?.name || b.botId || "").toLowerCase();
         if (!botName.includes(navatarFilter.toLowerCase())) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort descending by date/time
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateB - dateA; // latest date first
      return (b.start_time || "").localeCompare(a.start_time || ""); // latest time first
    });
  }, [bookings, dateFilter, navatarFilter, liveNavatars]);

  if (loading || !doctorProfile) {
    return (
      <div className="flex bg-slate-50 items-center justify-center h-screen w-full">
        <div className="animate-pulse text-blue-600 font-semibold text-lg flex items-center gap-2">
          <History className="h-6 w-6 animate-bounce" /> Loading History...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4 text-blue-700">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')} className="hover:bg-blue-50 hover:text-blue-700">
             <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Monitor className="h-6 w-6" />
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">Navatar</span>
          </div>
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

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
               <History className="h-8 w-8 text-blue-600" />
               <h1 className="text-3xl font-bold text-slate-800">Booking History</h1>
            </div>
            <p className="text-slate-500 mt-1">View all your completed and past Navatar sessions.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
             <div className="relative border-slate-200">
                <select 
                  className="h-10 w-full sm:w-64 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-600 appearance-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im02IDkgNiA2IDYtNiIvPjwvc3ZnPg==')] bg-[length:16px_16px] bg-no-repeat bg-[position:right_12px_center]"
                  value={navatarFilter}
                  onChange={(e) => setNavatarFilter(e.target.value)}
                >
                  <option value="">All Navatars</option>
                  {liveNavatars.map(nav => (
                    <option key={nav.id} value={nav.name?.toLowerCase() || nav.id.toLowerCase()}>
                      {nav.name || nav.id}
                    </option>
                  ))}
                </select>
             </div>
             <div className="relative">
                <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input 
                  type="date" 
                  className="pl-9 h-10 w-full sm:w-48 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-600"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
             </div>
          </div>
        </div>
        
        <Card className="flex-1 shadow-sm border-slate-200 flex flex-col min-h-[500px]">
          <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
             <CardTitle className="text-slate-800">Past Sessions</CardTitle>
             <div className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-3 py-1.5 rounded-full text-sm">
                {pastBookings.length} {pastBookings.length === 1 ? 'Session' : 'Sessions'}
             </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 flex flex-col">
            <ScrollArea className="flex-1 max-h-[calc(100vh-250px)] rounded-b-xl">
               {pastBookings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full min-h-[400px]">
                     <Clock className="h-12 w-12 mb-4 opacity-20" />
                     <p className="font-medium text-lg">No past sessions found</p>
                     <p className="text-sm mt-1">Your completed sessions will appear here.</p>
                  </div>
               ) : (
                  <div className="divide-y divide-slate-100">
                     {pastBookings.map((booking) => {
                        const botData = liveNavatars.find(n => n.id === booking.botId);
                        
                        return (
                           <div key={booking.id} className="p-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between transition-colors hover:bg-slate-50 relative group">
                              <div className="absolute inset-y-0 left-0 w-1 bg-slate-300 group-hover:bg-blue-300 transition-colors" />
                              <div className="flex items-start gap-4 pl-2">
                                <div className="min-w-[120px] text-center pt-1">
                                  <p className="text-lg font-bold text-slate-800">{formatTo12H(booking.start_time)}</p>
                                  <p className="text-xs text-slate-500">to {formatTo12H(booking.end_time)}</p>
                                </div>
                                <div className="hidden sm:block min-h-[48px] w-px bg-slate-200" />
                                <div>
                                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                                    {booking.date ? format(parseISO(booking.date), "EEEE, MMM do yyyy") : "Unknown Date"}
                                  </div>
                                  <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                                    <Bot className="h-4 w-4 text-blue-600" />
                                    {botData?.name || booking.botId}
                                  </h3>
                                  <p className="text-sm text-slate-500 mt-1 flex items-center gap-2 font-medium">
                                    <span className="inline-block w-2 h-2 rounded-full bg-slate-300" />
                                    Completed
                                  </p>
                                </div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
