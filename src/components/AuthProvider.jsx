"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setAuthError(null);

      if (firebaseUser) {
        try {
          // Verify doctor in DB
          const q = query(collection(db, "doctors"), where("email", "==", firebaseUser.email));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            const data = docSnap.data();
            
            if (data.status === 'active') {
              setUser(firebaseUser);
              setDoctorProfile({ id: docSnap.id, ...data });
            } else {
              setAuthError("Your doctor account is not active.");
              await signOut(auth);
              setUser(null);
              setDoctorProfile(null);
            }
          } else {
            setAuthError("Access denied. You are not registered as a doctor for any hospital.");
            await signOut(auth);
            setUser(null);
            setDoctorProfile(null);
          }
        } catch (error) {
          console.error("Error fetching doctor profile:", error);
          setAuthError("An error occurred during verification.");
          await signOut(auth);
          setUser(null);
          setDoctorProfile(null);
        }
      } else {
        setUser(null);
        setDoctorProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, doctorProfile, loading, authError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
