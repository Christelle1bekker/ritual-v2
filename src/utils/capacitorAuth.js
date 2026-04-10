import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase';

export const setupDeepLinkListener = () => {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener('appUrlOpen', async ({ url }) => {
    if (url.includes('access_token') || url.includes('code=')) {
      // Close the in-app browser if it's open
      try {
        await Browser.close();
      } catch {}

      // Extract the fragment/query and let Supabase handle it
      const hashOrQuery = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
      if (hashOrQuery) {
        const params = new URLSearchParams(hashOrQuery);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (access_token && refresh_token) {
          await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
        }
      }
    }
  });
};
