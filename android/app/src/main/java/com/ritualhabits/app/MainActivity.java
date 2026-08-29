package com.ritualhabits.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * PHANTOM-TAP GUARD — do not delete this override.
     *
     * Android keeps the intent that last launched a task and REDELIVERS it
     * verbatim when the user brings the app back from the recents screen after
     * the process has been killed. If the app was originally launched by
     * tapping a Ritual tile, that intent is our ACTION_VIEW deep link
     * (https://app.ritualhabits.com.au?tile={UID}).
     *
     * Capacitor's Bridge reads getIntent() during super.onCreate() via
     * Bridge.getIntentUri() and hands the URL to the web layer, which routes it
     * straight into the tile deep-link path. So a user who taps a tile on
     * Monday, whose app is then evicted by the OS, and who opens the app from
     * recents on Thursday would silently complete Monday's habit again on
     * Thursday — a data-corrupting phantom completion with no user action and
     * no visible cause. Genuine tile taps are unaffected: they arrive as fresh
     * intents (cold launch) or through onNewIntent (warm), neither of which
     * carries the history flag.
     *
     * The OS marks exactly this case with FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY,
     * so we strip the data URI from the redelivered intent and write it back
     * with setIntent() BEFORE super.onCreate() runs — after that call the
     * Bridge has already read it and the guard is too late. The intent keeps
     * its action and extras; only the deep-link payload is removed, which is
     * the single thing that must not be replayed.
     *
     * This guard also covers the cold-launch delivery path: Capacitor 8's
     * BridgeActivity.load() replays getIntent() through onNewIntent, which is
     * how a cold tile tap reaches the JS appUrlOpen listener at all — and that
     * replay happens after this cleaning, so JS needs no history check of its
     * own (and could not perform one anyway; the flags never reach JS).
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        Intent intent = getIntent();
        if (intent != null
                && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
                && Intent.ACTION_VIEW.equals(intent.getAction())
                && intent.getData() != null) {
            intent.setData(null);
            setIntent(intent);
        }
        super.onCreate(savedInstanceState);
    }
}
