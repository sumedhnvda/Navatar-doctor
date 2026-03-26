"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { FaGoogle } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Monitor } from "lucide-react";

export default function LoginPage() {
  const { user, loading, authError } = useAuth();
  const router = useRouter();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // router.push("/dashboard"); // Handled by useEffect
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
         setError("Invalid email or password.");
      } else {
         setError(err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // user state will trigger redirect via useEffect
    } catch (err) {
      console.error(err);
      setError("Google Login Failed.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  if (loading || user) {
    return (
      <div className="flex bg-blue-50 items-center justify-center min-vh-100 h-screen">
          <div className="animate-pulse text-blue-600 font-semibold text-lg flex items-center gap-2">
            <Monitor className="h-6 w-6 animate-bounce" /> Loading...
          </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-blue-50/50 flex-col px-4">
      <div className="mb-8 flex items-center justify-center gap-3 text-blue-700">
         <Monitor className="h-10 w-10 shrink-0" />
         <h1 className="text-3xl font-extrabold tracking-tight">Navatar</h1>
      </div>

      <Card className="w-full max-w-sm shadow-xl border-blue-100">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Sign in</CardTitle>
          <CardDescription>
            Enter your credentials or use Google to access the telepresence system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button 
                variant="outline" 
                onClick={handleGoogleLogin} 
                disabled={isGoogleLoading || isSubmitting}
                className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 relative"
            >
              {isGoogleLoading ? "Connecting..." : (
                <>
                  <FaGoogle className="absolute left-4 h-4 w-4 text-red-500" />
                  Sign in with Google
                </>
              )}
            </Button>
            
            {(error || authError) && (
               <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm font-medium text-red-600 text-center">
                 {error || authError}
               </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <div className="text-center text-xs text-muted-foreground mt-2">
            Need an account? Contact hospital administration.
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
