"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const AuthContext = createContext({
  user: null,
  doctorProfile: null,
  loading: true,
  authError: null,
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [doctorProfile, setDoctorProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clear previous profile listener if any
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!firebaseUser) {
        setUser(null);
        setDoctorProfile(null);
        setLoading(false);
        return;
      }

      // User exists, setup real-time profile listener
      setLoading(true);
      const q = query(
        collection(db, "doctors"), 
        where("email", "==", firebaseUser.email)
      );

      unsubscribeProfile = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
          setAuthError("Access denied. You are not registered as a doctor.");
          signOut(auth);
          setLoading(false);
          return;
        }

        const docSnap = snapshot.docs[0];
        const data = docSnap.data();

        if (data.status === 'active') {
          setUser(firebaseUser);
          setDoctorProfile({ id: docSnap.id, ...data });
          setAuthError(null);
        } else {
          setAuthError("Your doctor account is not active.");
          signOut(auth);
          setDoctorProfile(null);
        }
        setLoading(false);
      }, (error) => {
        console.error("Status sync error:", error);
        setAuthError("Connection error. Please try again.");
        setLoading(false);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, doctorProfile, loading, authError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
