import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Capacitor Preferences-backed storage for native (iOS/Android). Survives
// app updates and OS cache pressure better than the WKWebView's localStorage.
// Falls back to localStorage on web (browser dev / PWA).
const preferencesStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};

const webStorage = typeof window !== 'undefined' ? window.localStorage : undefined;
const authStorage = Capacitor.isNativePlatform() ? preferencesStorage : webStorage;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        // Deep links are routed through the existing CapApp.appUrlOpen
        // listener so we coordinate with NFC tile handling. The auth
        // listener calls exchangeCodeForSession / setSession explicitly
        // when it detects an auth callback URL.
        detectSessionInUrl: false,
      },
    })
  : null;

export { supabase };
