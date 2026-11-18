# Pomodoodle

A cosy online study room. Pick a hand-drawn study buddy, set a pomodoro timer and study in a full-screen room,
alone or with friends. Everyone in a room shares one timer: during focus every buddy sits at its own little desk;
on breaks they wander around. **Runs in the browser, nothing to install.**

## How it flows

1. **Greeting page:** a parade of buddies, your streak if you've been here before, and a **Start** button.
2. **Make your buddy** (step 1 of 2): name, animal, colour and decoration.
3. **Set your timer** (step 2 of 2): Classic 25/5, Deep work 50/10, Quick sprint 15/3 or your own minutes,
   then study **just me**, in a **new room**, or **join a room** with a code (invite links fill it in for you).
4. **The study room** opens **full screen**. Press **Esc** or **✕** and the timer pauses, with Resume / Change timer /
   End session. When the focus time is up a **"Rest time!"** pop-up appears with a little break tip
   (and "Break's over!" when it's time to focus again).

Everything else lives in the **☰ menu** (top right on every screen): Room, Timer, My buddy, Music, Achievements,
My progress and Settings.

## Features

**Your buddy**
- 6 original animals in a hand-drawn doodle style: cat, bunny, bear, dog, frog and duck.
- Any colour (colour picker + presets): belly, ears and eye colour adapt automatically.
- Decorations: bow, crown, flower, party hat, book, pencil.
- Walks around the room; drag it along the floor; tap it to edit it (opens ☰ → My buddy).
- Drinks water with you (water reminders), naps when you're away from the page for 5 minutes, and falls asleep late at night.

**Study rooms**
- Create a room → ☰ → Room → **Copy invite link** → friends open it, pick a buddy and the code is filled in for them.
- A chat box at the bottom of the room; messages pop up as speech bubbles. (Pausing with Esc/✕ pauses the shared timer for everyone.)
- Shared **pomodoro timer** run by the server: anyone can start, pause, skip or reset, and it switches focus ↔ break by itself.
- During focus every buddy gets its own desk, spread evenly across the room.
- Chat messages pop up as speech bubbles above your buddy.
- Tap a friend's buddy to **cheer** them on: it jumps with hearts and they get a message.
- Status for everyone: studying, on break, away, asleep, offline.
- Refresh or lose Wi-Fi? You reconnect and get your spot back (kept for 60 seconds).
- No room? The timer works solo too.

**Motivation**
- **Music:** lo-fi beats, rain on the window or ocean waves, generated live in the browser (Web Audio, no audio files),
  with a volume slider and a ♪ button in the room.
- **Your own music:** paste a YouTube or Spotify link (song, playlist, album or live stream) and it plays in a small
  player in the corner, which you can hide while it keeps playing. Your last 5 links are saved. YouTube plays full songs
  for everyone and pauses/resumes with the timer. Spotify plays full songs only for people logged in at spotify.com in
  that browser on a computer (otherwise 30-second previews).
  *Why not "Log in with Spotify"?* Spotify's API now limits new apps to 5 test users and requires Premium,
  so the normal embed players are used instead: no API keys, no login, no user limit.
- **12 achievements** (first session, 5 and 20 sessions, 3- and 7-day streaks, 2 hours in a day, night owl, early bird,
  study squad, cheerleader, hydrated…) with a toast and confetti when you unlock one.
- **Unlockable decorations:** crown (5 sessions), flower (3-day streak) and party hat (20 sessions).
- **My progress:** day streak, minutes today, total hours, a daily goal (sessions per day) and a bar chart of the week.
- A chime when a session ends (can be turned off).

**Website**
- Works on laptops, tablets and phones.
- Settings are saved in your browser (no account needed).
- Optional browser notifications when a session ends, even if the tab is in the background.
- Scrapbook design: gingham, polka dots, washi tape, sticker buttons, and doodle buddies.
- Progress and settings are saved in your browser (localStorage).

## Accounts (optional): save progress to the cloud

Guests can use everything without an account; progress is saved in their browser. If you switch accounts on,
people can also **sign in with Google or an email link** (no passwords) in ☰ → Account, and their streak,
achievements, buddy and settings sync across devices. The first sign-in uploads what's already in that browser,
so nobody loses their streak. Merging takes the larger number for each count, so syncing twice never double counts.
If the two variables below aren't set, accounts are simply hidden.

Accounts use [Supabase](https://supabase.com) (free plan). No SDK: `public/cloud.js` talks to Supabase's REST API with `fetch`.
Each person can only read and change their own row, enforced in the database by Row Level Security (`supabase/schema.sql`).

### Set it up (about 15 minutes)

1. **Create a Supabase project** at supabase.com → New project (region: Southeast Asia (Singapore)).
2. **Create the table:** SQL Editor → New query → paste everything from `supabase/schema.sql` → Run.
3. **Copy two values** from Project Settings:
   - **Data API → Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **API Keys → Publishable key** (starts with `sb_publishable_`). This key is meant to be public;
     never use the *secret* / `service_role` key here.
4. **Allow your site to receive sign-ins:** Authentication → URL Configuration
   - **Site URL:** your Render link, e.g. `https://pomodoodle-xxxx.onrender.com`
   - **Redirect URLs:** add `https://pomodoodle-xxxx.onrender.com/` and `http://localhost:8080/`
5. **Email links** work straight away (Authentication → Sign In / Providers → Email is on by default).
   Supabase's built-in email sender only allows a few emails per hour; that's fine for a student project.
6. **Google sign-in** (optional):
   - In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen: set it up
     (External, app name, your email).
   - Credentials → Create credentials → OAuth client ID → **Web application**.
     - Authorized JavaScript origins: your Render link (and `http://localhost:8080`)
     - Authorized redirect URIs: the **Callback URL** shown in Supabase → Authentication → Sign In / Providers → Google
       (it looks like `https://abcdefgh.supabase.co/auth/v1/callback`)
   - Paste the Client ID and Client Secret into that Google page in Supabase and turn it on.
7. **Give the values to the server.** On Render → your service → Environment, add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_PUBLISHABLE_KEY` = the publishable key

   Render redeploys, and ☰ → Account appears.

To try accounts on your own computer:

```bash
# macOS / Linux / Git Bash
SUPABASE_URL=https://abcdefgh.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx npm start
```
```powershell
# Windows PowerShell
$env:SUPABASE_URL="https://abcdefgh.supabase.co"; $env:SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxx"; npm start
```

**Privacy:** signed-in users see a "What's saved and why" note: their email, buddy, settings and study progress, used
only for syncing, never shared, no ads or trackers. Chat and rooms are never saved. They can delete their cloud data
any time (☰ → Account), which also signs them out.

## Run it on your computer

You need [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

```bash
npm start
```

Open **http://localhost:8080**. To test with a "friend", open the invite link in a second browser or a private/incognito window
(each window with its own storage counts as a different person).

## Put it online (free) on Render

The website and the room server are the same app, so it's **one** deploy.

1. Push this folder to a GitHub repo.
2. On render.com: **New → Web Service** → pick the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Region:** Singapore
   - **Instance type:** Free
4. Click **Deploy**. You'll get a link like `https://pomodoodle-xxxx.onrender.com`. Share it!

Render sets the port automatically, and the site switches to secure `wss://` connections by itself on `https://`.

**Why not Vercel or Netlify?** Study rooms keep a live connection open for the whole session (hours).
Vercel and Netlify run short-lived functions, so they can't hold those connections. Render runs a normal server, which can.

**Free plan note:** Render's free servers go to sleep after 15 minutes without visitors. The first visit after that can
take up to a minute to load while it wakes up; after that it's fast. Rooms live in memory, so when the server sleeps or
restarts, empty rooms are gone (just create a new one).

## Project structure

```
pomodoodle/
├── package.json         npm start → node server/index.js
├── server/
│   ├── index.js         serves the website (+ /config.js) and study rooms (presence, buddies, chat, cheers, shared timer)
│   ├── websocket.js     small WebSocket server (RFC 6455) on Node's http module, no npm packages
│   └── timer.js         pomodoro logic (same file as public/shared/timer.js)
├── supabase/
│   └── schema.sql       the progress table + Row Level Security rules (run once in Supabase)
└── public/              the website
    ├── index.html       the 4 screens, pause + rest pop-ups, ☰ menu
    ├── app.css          scrapbook style: screens, menu, pop-ups, music, badges, stats
    ├── scene.css        the room (wallpaper, window, shelf, floor) + buddies, bubbles, timer board
    ├── web-api.js       browser bridge: saved settings, invite links, idle detection, toasts, notifications
    ├── brain.js         buddies + networking + timer + status ("the brain")
    ├── ui.js            screens, full screen + pause, pop-ups, ☰ menu, confetti
    ├── progress.js      sessions, streaks, achievements, unlockable decorations
    ├── music.js         lo-fi / rain / waves made with Web Audio + the session chime
    ├── mymusic.js       YouTube / Spotify links → small embedded player
    ├── cloud.js         optional accounts: sign in (Google / email link) + cloud sync via Supabase
    └── shared/
        ├── sprites.js   original doodle animals drawn in code
        └── timer.js     pomodoro logic
```

## How it works (the interesting bits)

- **A timer that can't drift.** The server never sends "25 minutes left" every second. It stores when the current
  phase *ends*. Each browser measures the difference between its clock and the server's (ping/pong, trusting the fastest
  round trips) and works out the time left itself, so every screen shows the same countdown. The server switches
  focus → break on schedule.
- **Smooth movement without flooding the network.** Buddies don't send their position 60 times a second. They send
  events like "started walking right from 30% across the room at time T, at this speed", plus a keyframe every 8 seconds.
  Every browser animates the walk itself. Positions are fractions of the room width, so phones and laptops agree.
- **Fair desks.** During focus, desk positions come from the sorted list of people in the room, so every screen puts
  everyone in the same seat without any extra messages.
- **Doodles from shapes.** Each buddy is a list of ellipses, polygons and lines. The hand-drawn look comes from shifting the
  colour fills slightly (like colouring outside the lines) and drawing each outline twice with small seeded wobbles. Walking
  frames use different wobbles, so lines "wiggle" like a hand-drawn animation. Canvases are drawn at the screen's pixel
  density, so they stay sharp on phones. Any colour and decoration works in every pose.
- **No-dependency server.** The WebSocket protocol (handshake, masking, framing, fragmentation, ping/pong, close codes)
  is implemented on Node's `http` module, with message size limits, spam protection and safe static-file serving.

## Limits

- Max 12 buddies per room.
- Rooms are kept in memory: if the server restarts, rooms close and the page asks you to create a new one.
- Some browsers (iPhone Safari) don't allow full screen for web pages; the room still fills the whole window and Esc/✕ still pause.
- Browsers slow down background tabs, but the timer stays correct because it's based on the end time, not a countdown.
