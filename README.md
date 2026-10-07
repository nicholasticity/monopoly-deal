# Monopoly Deal

A browser version of the Monopoly Deal card game, in plain JavaScript with no frameworks.
Play against 1–4 computer opponents on a 2D card table, or **online with friends**: create a
room, send the invite link, and play in your browsers (2–5 players, bots fill empty seats).

## Running

```bash
npm install
npm run dev        # open the printed URL (default http://localhost:5173)
```

The dev server also hosts the online rooms, so solo and online play both work out of the box.

Other scripts:

| Command            | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `npm run build`    | Production build into `dist/` (relative paths, host anywhere) |
| `npm start`        | Production server: the built game and online rooms on one port |
| `npm run preview`  | Serve the production build locally (online rooms included)    |
| `npm run simulate` | Play 300 headless AI-vs-AI games to sanity-check the rules     |
| `npm run test:online` | Headless multiplayer test: scripted clients play full games over WebSocket |

## Playing online with friends

1. On the start screen pick **🌐 Online with friends**, enter a name and press **Create a room**.
2. Send your friends the **invite link** from the lobby (or just the 4-letter room code — they
   pick *Online with friends*, type the code and press **Join room**).
3. Everyone shows up in the lobby. The host (👑) can add bots, remove players, choose the game
   speed and press **Start game** once there are at least 2 players. Up to 5 can play.

While you play:

- Every player sees only their own hand; the server runs the game and never sends anyone
  else's hidden cards to your browser.
- **Chat** with the button in the top bar (or press Enter). Messages that arrive while it's
  closed pop up briefly.
- **Talk** with 🎙️ (in the lobby or the top bar): everyone who has joined voice chat hears
  each other, and a green ring shows who's speaking. Press it again to mute or leave, or press
  **M** to mute. See [Voice chat](#voice-chat).
- Each decision has a time limit: 90 s per play on your turn, 45 s to pay or discard and
  30 s for a Just Say No. The clock shows in the status bar for the last 30 s. If you miss a
  turn (or two prompts in a row) a bot plays for you until you press **I'm back**.
- **Refresh or lose connection?** You get your seat back automatically. If you're gone for more
  than 15 s a bot covers for you until you return. Leaving the room hands your cards to a bot
  for the rest of that game.
- Friends who join mid-game watch and are dealt in next game. The host can end a game early
  with **End game**; when a game finishes everyone goes back to the lobby for a rematch.

### Getting your friends connected

The game and its rooms are served by one Node process, so your friends need to be able to
reach it. Pick whichever suits you:

**Same Wi-Fi / LAN** — run `npm run dev -- --host` (or `npm run build && npm start`) and send
the *Network* address it prints, e.g. `http://192.168.1.20:5173`. You may need to allow Node
through your firewall. Voice chat doesn't work over a plain http address like this one (see
[Voice chat](#voice-chat)).

**Over the internet from your computer** — build and start the server, then open a tunnel:

```bash
npm run build && npm start                      # http://localhost:3000
npx cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
```

Open the `https://….trycloudflare.com` (or ngrok) address yourself, create a room there and
share the invite link. (A link created on `localhost` only works on your own computer; the
lobby warns you about this.)

**Host it on Render** (free plan works):

1. Put the project in a GitHub repository.
2. On [render.com](https://render.com) choose **New → Blueprint** and pick the repository.
   `render.yaml` sets up the build, start command and health check for you.
3. When the deploy finishes, open `https://<your-service>.onrender.com`, create a room and send
   the invite link.

On the free plan the service sleeps after ~15 minutes without visitors; the next visit takes
up to a minute to wake it, and any open rooms are lost when it sleeps or redeploys.

Vercel, Netlify and GitHub Pages can only serve the static build (solo play): they can't run
the long-lived WebSocket server that online rooms need.

**Other hosts** — any Node host that supports WebSockets works (Railway, Fly.io, a VPS…):

| Setting       | Value                              |
| ------------- | ---------------------------------- |
| Build command | `npm install && npm run build`     |
| Start command | `npm start`                        |
| Health check  | `/healthz`                         |

The server listens on `PORT` (default 3000) and `HOST` (default `0.0.0.0`), and serves
WebSockets on `/ws` of the same port. Rooms live in memory, so run a single instance;
a restart closes open rooms.

### Voice chat

Voice goes straight from browser to browser (WebRTC); the server only passes along the
connection details and never carries any audio.

- Browsers only allow the microphone on **https** pages and on `localhost`. A plain
  `http://192.168.…` LAN address is fine for the game but not for voice, so to talk use a
  tunnel or a host such as Render (both are https).
- Headphones help: echo cancellation is on, but speakers can still feed back.
- Some networks (strict office or mobile ones) block direct connections, and voice then says
  it couldn't connect to someone. A TURN server can relay the audio for them: set
  `ICE_SERVERS` on the server to a JSON list of servers, for example

  ```bash
  ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"me","credential":"secret"}]' npm start
  ```

  Without it, public STUN servers from Google and Cloudflare are used.

### Safety on a public server

- The server runs the game and checks every move; browsers never receive other players'
  hidden cards.
- There are no accounts and nothing is stored: names, chat and rooms live in memory only.
  Anyone with a room's code can join it, so share codes only with friends; the host can
  remove anyone.
- Names and chat are cleaned and shown as plain text. Chat is rate-limited, messages are
  capped in size, and each address is limited in open connections (16), messages and how
  many rooms it can create or try to join per minute (30), which stops room-code guessing.
- Voice chat connects browsers directly, so the players you talk to can see your IP address.
  Only players who have joined voice in the same room are connected.
- An unexpected error is logged instead of taking down every room.

## How to play

Be the first to collect **three complete property sets of different colours**.

- At the start of your turn you draw 2 cards (5 if your hand is empty).
- You may play up to **3 cards** per turn. Click a card in your hand for its options:
  - **Money / action cards** can be banked as money.
  - **Properties** go to your table; **wild cards** let you pick the colour.
  - **Action cards** — Pass Go, Debt Collector, It's My Birthday, Sly Deal, Forced Deal,
    Deal Breaker, House, Hotel — and **Rent** cards (optionally with Double The Rent).
- Click a wild card already on your table to move it to another colour (free).
- **Just Say No** is offered automatically whenever an action targets you, and can be
  countered with another Just Say No.
- When you pay a debt you choose the cards (or press **Auto-select**). No change is given. The
  payment dialog shows the amount owed next to what you have: your bank cards, table and total.
- You may hold at most 7 cards at the end of your turn.

Controls: hover a card to see it full size, **E** ends your turn, **Esc** closes a menu.
The **Log** button shows everything that has happened.

Each table shows its owner's property sets; banked money appears only as their total next
to their name (hover it to see the bills).

On a phone held upright every table stays in view, one per row: each player's name, money,
sets and hand size sit in a bar down the left of their cards, and the deck and discard pile
shrink to two counts in the top bar, where cards are drawn from and discarded to.

## Code layout

```
src/
  game/      pure rules — no rendering
    cards.js     the 106-card deck
    rules.js     set sizes, rent, payments, validation
    engine.js    async turn loop; asks controllers for every decision
    ai.js        computer opponents
  render/    the table (DOM + CSS)
    view.js      player panels, card layout and animation
    textures.js  card faces drawn on canvas
  ui/
    hud.js       menus, modals, toasts, log
    human.js     turns HUD input into engine actions
    lobby.js     online room lobby
    chat.js      room chat panel
  net/       online client
    connection.js  WebSocket with automatic reconnect
    online.js      one online session: lobby, game, prompts, chat, voice
    mirror.js      read-only copy of the server's game for the view and HUD
    voice.js       voice chat: microphone, browser-to-browser calls, who's talking
  main.js    wires it all together
server/
  index.js     production server (static files + rooms)
  hub.js       /ws endpoint, room codes, message routing
  room.js      lobby, seats, bots, timeouts, reconnects; runs the real engine
  viewer.js    per-player snapshots that hide other players' cards
scripts/
  simulate.mjs     headless AI games
  online-smoke.mjs headless multiplayer games over real sockets
```

The engine talks to players only through a controller interface (`chooseTurnAction`,
`choosePayment`, `chooseJustSayNo`, `chooseDiscards`), so humans and the AI are
interchangeable, and the engine runs headless without a view.

Online, the server runs that same engine. A human seat's controller forwards each decision
to that player's browser as a `request` and waits for the `response`, falling back to the AI
on timeout or disconnect. After every change the server sends each player a snapshot of the
table in which other players' hidden cards carry no details and fresh ids, so the browser
can't peek. The client applies snapshots to a mirror game that the existing table view and
HUD read from, and answers requests with the same `HumanController` used for solo play.
