import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Eye, EyeOff, CheckCircle, KeyRound, MessageSquare } from 'lucide-react';
import { User as UserType } from '../types';

interface AuthScreenProps {
  onAuthSuccess: (user: UserType, securityBackup?: { passwordHash: string; salt: string }) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Seamless virtual email mapping:
    // If registering, we automatically map to: username@privamsg.local
    // If logging in, if they typed username, we append @privamsg.local, otherwise use as-is
    const formattedEmail = isSignUp 
      ? (username.trim().toLowerCase() + '@privamsg.local')
      : (username.includes('@') ? username.trim() : (username.trim().toLowerCase() + '@privamsg.local'));

    const endpoint = isSignUp ? '/api/auth/register' : '/api/auth/login';
    const body = isSignUp 
      ? { email: formattedEmail, username: username.trim(), password } 
      : { email: formattedEmail, password };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let data = await response.json();

      // If logging in fails (e.g., container restarted and wiped memory), check local backups
      if (!isSignUp && !response.ok) {
        const backupStr = localStorage.getItem('privamsg_credentials_backup');
        const archiveStr = localStorage.getItem('privamsg_identities_archive');
        
        let backupToUse = null;
        if (backupStr) {
          try {
            const singularBackup = JSON.parse(backupStr);
            if (
              singularBackup.email.toLowerCase().trim() === formattedEmail.toLowerCase().trim() ||
              singularBackup.username.toLowerCase().trim() === username.trim().toLowerCase()
            ) {
              backupToUse = singularBackup;
            }
          } catch (e) {}
        }
        
        if (!backupToUse && archiveStr) {
          try {
            const archive = JSON.parse(archiveStr);
            const keyByEmail = formattedEmail.toLowerCase().trim();
            if (archive[keyByEmail]) {
              backupToUse = archive[keyByEmail];
            } else {
              const matchedFromArchive = Object.values(archive).find(
                (u: any) => u.username.toLowerCase().trim() === username.trim().toLowerCase()
              );
              if (matchedFromArchive) {
                backupToUse = matchedFromArchive;
              }
            }
          } catch (e) {}
        }

        if (backupToUse) {
          console.log('[PrivaMSG Self-Heal] Re-routing backup to self-heal server memory...');
          try {
            const restoreResponse = await fetch('/api/sync/restore-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: backupToUse.id,
                email: backupToUse.email,
                username: backupToUse.username,
                avatar: backupToUse.avatar,
                status: backupToUse.status || 'Hey there! I am using PrivaMSG.',
                passwordHash: backupToUse.passwordHash,
                salt: backupToUse.salt,
                contacts: backupToUse.contacts || []
              })
            });

            if (restoreResponse.ok) {
              const restoreResult = await restoreResponse.json();
              if (restoreResult.success) {
                console.log('[PrivaMSG Self-Heal] Server memory successfully re-populated. Retrying login endpoint...');
                // Retry login
                const retryResponse = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                if (retryResponse.ok) {
                  response = retryResponse;
                  data = await retryResponse.json();
                }
              }
            }
          } catch (restoreError) {
            console.error('[PrivaMSG Self-Heal] Background login self-heal crashed:', restoreError);
          }
        }
      }

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      if (isSignUp) {
        if (data.user && data.securityBackup) {
          const credentialsBackup = {
            ...data.user,
            passwordHash: data.securityBackup.passwordHash,
            salt: data.securityBackup.salt
          };
          localStorage.setItem('privamsg_credentials_backup', JSON.stringify(credentialsBackup));
          
          try {
            const archiveStr = localStorage.getItem('privamsg_identities_archive');
            const archive = archiveStr ? JSON.parse(archiveStr) : {};
            archive[data.user.email.toLowerCase().trim()] = credentialsBackup;
            localStorage.setItem('privamsg_identities_archive', JSON.stringify(archive));
          } catch (e) {
            console.error('Failed to sync registration to local user archive:', e);
          }
        }
        setSuccessMsg('Identity registered successfully! Redirecting...');
        setTimeout(() => {
          setIsSignUp(false);
          setSuccessMsg('');
          setPassword('');
          setLoading(false);
        }, 2000);
      } else {
        if (data.user && data.securityBackup) {
          const credentialsBackup = {
            ...data.user,
            passwordHash: data.securityBackup.passwordHash,
            salt: data.securityBackup.salt
          };
          localStorage.setItem('privamsg_credentials_backup', JSON.stringify(credentialsBackup));
          
          try {
            const archiveStr = localStorage.getItem('privamsg_identities_archive');
            const archive = archiveStr ? JSON.parse(archiveStr) : {};
            archive[data.user.email.toLowerCase().trim()] = credentialsBackup;
            localStorage.setItem('privamsg_identities_archive', JSON.stringify(archive));
          } catch (e) {
            console.error('Failed to sync login session to local user archive:', e);
          }
        }
        onAuthSuccess(data.user, data.securityBackup);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  return (
    <div id="auth-screen-container" className="min-h-screen w-screen flex flex-col items-center justify-center bg-[#070b0e] text-slate-100 p-4 relative overflow-hidden">

      {/* Background Graphic elements with massive glass glows */}
      <div className="absolute top-[-25%] left-[-15%] w-[70%] h-[70%] rounded-full ambient-glow-teal blur-[100px] -z-10 pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-15%] w-[70%] h-[70%] rounded-full ambient-glow-green blur-[100px] -z-10 pointer-events-none" />
      <div className="absolute top-[35%] left-[30%] w-[40%] h-[40%] rounded-full ambient-glow-indigo blur-[120px] -z-10 pointer-events-none" />

      {/* Decorative Grid Matrix */}
      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:3rem_3rem] -z-20 pointer-events-none" />

      {/* Auth Card Container */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 15, delay: 0.1 }}
        className="w-full max-w-[430px] bg-[#0c141a]/90 backdrop-blur-[24px] rounded-[32px] p-9 border border-[#1f3c38]/70 shadow-[0_25px_60px_rgba(0,0,0,0.85),0_0_40px_var(--color-primary-glow-light)] relative z-20 overflow-hidden"
        id="auth-panel-card"
        whileHover={{
          borderColor: "var(--color-primary)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.9), 0 0 50px var(--color-primary-glow)",
          transition: { duration: 0.4 }
        }}
      >
        {/* Premium Glass Glare & Internal Corner Glows */}
        <div className="absolute top-0 left-0 w-36 h-36 bg-gradient-to-br from-[var(--color-primary)]/12 to-emerald-500/0 rounded-full blur-[30px] pointer-events-none -z-10" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_25%,var(--color-primary-glow-light)_40%,rgba(255,255,255,0.05)_50%,var(--color-primary-glow-light)_60%,transparent_75%)] pointer-events-none rounded-[32px]" />
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[var(--color-primary)]/25 to-transparent pointer-events-none" />

        {/* Card Header Content */}
        <div className="flex flex-col items-center mb-8 select-none">
          {/* Animated Glow Title with letter-by-letter hover size & shine effects */}
          {(() => {
            if (isSignUp) {
              return (
                <div className="flex flex-col items-center justify-center font-display leading-tight text-center">
                  {/* Row 1: PrivaMSG */}
                  <div className="flex justify-center items-center">
                    {"PrivaMSG".split("").map((char, index) => {
                      const isM = char === 'M' && index === 5;
                      return (
                        <motion.span
                          key={index}
                          className={`inline-block cursor-default text-3xl md:text-[36px] font-extrabold ${
                            isM 
                              ? "text-[var(--color-primary)] font-black drop-shadow-[0_0_15px_var(--color-primary-glow)] mx-[1px]" 
                              : "text-white"
                          }`}
                          style={{
                            textShadow: isM ? '0 0 15px var(--color-primary-glow)' : 'none',
                            transformOrigin: "bottom"
                          }}
                          whileHover={{
                            scale: 1.35,
                            y: -5,
                            color: "var(--color-primary)",
                            textShadow: "0 0 25px var(--color-primary)",
                          }}
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 11
                          }}
                        >
                          {char}
                        </motion.span>
                      );
                    })}
                  </div>
                  
                  {/* Row 2: - Sign Up */}
                  <div className="flex justify-center items-center mt-1 text-2xl md:text-[27px] text-slate-300">
                    {"- Sign Up".split("").map((char, index) => {
                      return (
                        <motion.span
                          key={index}
                          className="inline-block cursor-default font-extrabold tracking-wide"
                          style={{ transformOrigin: "bottom" }}
                          whileHover={{
                            scale: 1.3,
                            y: -4,
                            color: "var(--color-primary)",
                            textShadow: "0 0 15px var(--color-primary-glow)",
                          }}
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 11
                          }}
                        >
                          {char === " " ? "\u00A0" : char}
                        </motion.span>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Sign In Title: PrivaMSG
            return (
              <div className="flex justify-center items-center font-display text-4.5xl md:text-[45px] font-extrabold tracking-tight text-white leading-tight">
                {"PrivaMSG".split("").map((char, index) => {
                  const isM = char === 'M' && index === 5;
                  return (
                    <motion.span
                      key={index}
                      className={`inline-block cursor-default ${
                        isM 
                          ? "text-[var(--color-primary)] font-black drop-shadow-[0_0_15px_var(--color-primary-glow)] mx-[1px]" 
                          : "text-white"
                      }`}
                      style={{
                        textShadow: isM ? '0 0 20px var(--color-primary-glow)' : 'none',
                        transformOrigin: "bottom"
                      }}
                      whileHover={{
                        scale: 1.35,
                        y: -5,
                        color: "var(--color-primary)",
                        textShadow: "0 0 30px var(--color-primary)",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 11
                      }}
                    >
                      {char}
                    </motion.span>
                  );
                })}
              </div>
            );
          })()}
          
          <p className="text-[10px] font-bold tracking-[0.16em] text-[var(--color-primary)] text-center mt-3 uppercase font-mono">
            LOCAL SECURE TELEMETRY
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.form 
            key={isSignUp ? "register" : "login"}
            initial={{ opacity: 0, x: isSignUp ? 8 : -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isSignUp ? -8 : 8 }}
            transition={{ duration: 0.15 }}
            onSubmit={handleSubmit}
            className="space-y-5"
            id="auth-credentials-form"
          >
            {isSignUp && (
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase ml-1">
                  Full Name
                </label>
                <input
                  id="signup-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-[#121c22]/90 border border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all font-sans font-medium"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase ml-1">
                Username / ID
              </label>
              <input
                id="auth-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="johndoe123"
                className="w-full bg-[#121c22]/90 border border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all font-sans font-medium"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase ml-1">
                Access Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#121c22]/90 border border-slate-800/80 rounded-2xl pl-5 pr-12 py-3.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all font-sans font-medium"
                />
                <button
                  id="auth-password-toggle"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-950/40 border border-red-800/40 text-red-300 px-4 py-3 rounded-xl text-xs flex items-center space-x-2.5"
                id="auth-error-banner"
              >
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0 animate-pulse" />
                <span>{error}</span>
              </motion.div>
            )}

            {successMsg && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 px-4 py-3 rounded-xl text-xs flex items-center space-x-2.5"
                id="auth-success-banner"
              >
                <CheckCircle className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 animate-bounce" />
                <span>{successMsg}</span>
              </motion.div>
            )}

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-4 mt-2 active:scale-[0.99] disabled:bg-slate-800 rounded-2xl font-black text-xs md:text-sm tracking-widest text-white transition-all shadow-[0_8px_30px_var(--color-primary-glow-light)] hover:shadow-[0_8px_35px_var(--color-primary-glow)] hover:brightness-110 cursor-pointer flex items-center justify-center uppercase"
              style={{ background: 'var(--gradient-btn)' }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>{isSignUp ? "Register Identity" : "Sign In"}</span>
              )}
            </button>
          </motion.form>
        </AnimatePresence>

        {/* Mode Toggle Link */}
        <div className="mt-7 text-center">
          <button
            id="auth-toggle-mode-btn"
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setSuccessMsg('');
            }}
            className="text-xs text-slate-400 hover:text-[var(--color-primary)] transition-colors font-semibold tracking-wide cursor-pointer"
          >
            {isSignUp 
              ? "Already have an account? Sign In" 
              : "Don't have an account? Sign Up"}
          </button>
        </div>
      </motion.div>

      {/* Applet Copyright */}
      <span className="text-[10px] text-slate-600 font-sans mt-8 tracking-widest uppercase">
        © PRIVAMSG PROTOCOL SYSTEM. ALL SESSIONS PROTECTED.
      </span>
    </div>
  );
}
