import React, { useState, useEffect } from 'react';
import { User } from './types';
import AuthScreen from './components/AuthScreen';
import PrivaMsgApp from './components/PrivaMsgApp';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Keep credential backup status/contacts in sync with the active session
  useEffect(() => {
    if (user) {
      const existingBackupStr = localStorage.getItem('privamsg_credentials_backup');
      if (existingBackupStr) {
        try {
          const existingBackup = JSON.parse(existingBackupStr);
          const updatedBackup = {
            ...existingBackup,
            username: user.username,
            avatar: user.avatar,
            status: user.status,
            contacts: user.contacts || []
          };
          
          localStorage.setItem('privamsg_credentials_backup', JSON.stringify(updatedBackup));
          
          // Also synchronize profile changes into the multi-account archive so it contains up-to-date values
          const archiveStr = localStorage.getItem('privamsg_identities_archive');
          const archive = archiveStr ? JSON.parse(archiveStr) : {};
          if (updatedBackup.email) {
            archive[updatedBackup.email.toLowerCase().trim()] = updatedBackup;
            localStorage.setItem('privamsg_identities_archive', JSON.stringify(archive));
          }
        } catch (err) {
          console.error('Failed to sync updated profiles to local credentials backup:', err);
        }
      }
    }
  }, [user]);

  // Check for existing session in localStorage on mount
  useEffect(() => {
    const checkSession = async () => {
      const savedUser = localStorage.getItem('privamsg_session');
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser) as User;
          
          // Re-validate against the database server to ensure consistency
          const response = await fetch(`/api/users/${parsed.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.user) {
              setUser(data.user);
              localStorage.setItem('privamsg_session', JSON.stringify(data.user));
            } else {
              await attemptRestore(parsed);
            }
          } else if (response.status === 404) {
            await attemptRestore(parsed);
          } else {
            localStorage.removeItem('privamsg_session');
          }
        } catch (err) {
          console.error('Session restoration fail:', err);
          localStorage.removeItem('privamsg_session');
        }
      }
      setSessionLoading(false);
    };

    const attemptRestore = async (parsedUser: User) => {
      const backupStr = localStorage.getItem('privamsg_credentials_backup');
      if (backupStr) {
        try {
          const backup = JSON.parse(backupStr);
          const restoreResponse = await fetch('/api/sync/restore-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: backup.id,
              email: backup.email,
              username: backup.username,
              avatar: backup.avatar || parsedUser.avatar,
              status: backup.status || parsedUser.status,
              passwordHash: backup.passwordHash,
              salt: backup.salt,
              contacts: backup.contacts || parsedUser.contacts || []
            })
          });

          if (restoreResponse.ok) {
            const restoredResult = await restoreResponse.json();
            if (restoredResult.success) {
              console.log('[PrivaMSG Self-Heal] Re-registered user instance on restarted container successfully.');
              setUser(parsedUser);
              localStorage.setItem('privamsg_session', JSON.stringify(parsedUser));
            } else {
              localStorage.removeItem('privamsg_session');
            }
          } else {
            localStorage.removeItem('privamsg_session');
          }
        } catch (err) {
          console.error('[PrivaMSG Self-Heal] Background restore failed:', err);
          localStorage.removeItem('privamsg_session');
        }
      } else {
        localStorage.removeItem('privamsg_session');
      }
    };

    checkSession();
  }, []);

  const handleAuthSuccess = (authenticatedUser: User, securityBackup?: { passwordHash: string; salt: string }) => {
    setUser(authenticatedUser);
    localStorage.setItem('privamsg_session', JSON.stringify(authenticatedUser));
    if (securityBackup) {
      localStorage.setItem('privamsg_credentials_backup', JSON.stringify({
        ...authenticatedUser,
        passwordHash: securityBackup.passwordHash,
        salt: securityBackup.salt
      }));
    }
  };

  const handleProfileUpdate = (updatedUser: User) => {
    setUser(updatedUser);
    localStorage.setItem('privamsg_session', JSON.stringify(updatedUser));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('privamsg_session');
    localStorage.removeItem('privamsg_credentials_backup');
  };

  if (sessionLoading) {
    return (
      <div 
        id="loading" 
        className="min-h-screen w-screen bg-[#090e11] flex flex-col items-center justify-center font-mono text-xs text-slate-500"
      >
        <div className="w-10 h-10 border-2 border-slate-600 border-t-[var(--color-primary)] rounded-full animate-spin mb-4" />
        <p className="animate-pulse">DECRYPTING SESSION STORAGE...</p>
      </div>
    );
  }

  return (
    <div 
      id="app-root-pane" 
      className="min-h-screen w-screen overflow-hidden bg-[#090e11]"
    >
      {!user ? (
        <AuthScreen 
          onAuthSuccess={handleAuthSuccess} 
        />
      ) : (
        <PrivaMsgApp 
          currentUser={user} 
          onLogout={handleLogout} 
          onProfileUpdate={handleProfileUpdate}
        />
      )}
    </div>
  );
}
