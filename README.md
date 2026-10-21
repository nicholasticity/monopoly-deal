# Monopoly Deal, Call Bridge, Judgement, Bingo, Wordle & Pool

Six games in one browser app, in plain JavaScript with no frameworks: **Monopoly Deal**,
the trick-taking games **Call Bridge** and **Judgement**, pen-and-paper **Bingo** (the 5×5,
1–25 kind), a **Wordle** race and 8-ball **Pool**. Pick one on the home screen, then play against 1–4 computer opponents on a
2D table, or
**online with friends**: create a room, send the
invite link, and play in your browsers (up to 8 players, bots fill empty seats).

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
| `npm run simulate:callbridge` | The same for Call Bridge (200 games): how often bids are made, missed or overshot |
| `npm run simulate:bingo` | The same for Bingo: game length, shared wins, and smart callers against random ones |
| `npm run simulate:judgement` | The same for Judgement (120 games): checks hand sizes, trumps, the dealer's ruled-out bid and all three scorings |
| `npm run simulate:pool` | Checks the 8-ball rules and that a shot replays the same, then plays 40 bot games (1 vs 1 and 2 vs 2) |
| `npm run simulate:wordle` | Checks Wordle's marking and word lists, how many guesses the bots take, and races bots through whole games |
| `npm run test:online` | Headless multiplayer test: scripted clients play full games of all six over WebSocket |

## Playing online with friends

1. Pick a game, then on its start screen pick **🌐 Online with friends**, enter a name and
   press **Create a room**.
2. Send your friends the **invite link** from the lobby (or just the 4-letter room code — they
   pick *Online with friends*, type the code and press **Join room**).
3. Everyone shows up in the lobby. The host (👑) can add bots, remove players and press
   **Start game** once there are at least 2 players. Up to 8 can play.

A room plays the game you picked on the home screen. The host can switch between Monopoly
Deal, Call Bridge, Judgement, Bingo, Wordle and Pool in the lobby between games (and pick
Judgement's scoring, or for Wordle, 5, 10 or 20 words). An invite link skips the game picker, because
the room decides the game.

While you play:

- Every player sees only their own hand (or Bingo grid, or Wordle letters); the server runs
  the game and never sends anyone else's hidden cards to your browser.
- **Chat** with the button in the top bar (or press Enter). Messages that arrive while it's
  closed pop up briefly.
- **Talk** with 🎙️ (in the lobby or the top bar): everyone who has joined voice chat hears
  each other, and a green ring shows who's speaking. Press it again to mute or leave, or press
  **M** to mute. See [Voice chat](#voice-chat). (In Wordle, Enter and M are for your guess:
  use the buttons instead.)
- **Listen together** with 🎵 (in the lobby or the top bar): paste a YouTube link and everyone
  in the room hears the same song at the same moment. Anyone can queue songs, pause, play
  and skip, for everyone; the volume, mute and "Music off for me" are only yours. The player
  sits in a small card you can drag anywhere. See [Music](#music).
- Each decision has a time limit: 90 s per play on your turn, 45 s to pay or discard and
  30 s for a Just Say No. In Call Bridge you have 45 s to call trumps, bid or play a card (in
  Judgement, to bid or play); in
  Bingo, 60 s to arrange your grid and 30 s to call a number. A Wordle word stays open for
  3 minutes at most, with its own clock in your bar. The
  clock shows in the status bar for the last 30 s. If you miss a turn (or two prompts in a
  row) a bot plays for you until you press **I'm back**.
- **Refresh or lose connection?** You get your seat back automatically. If you're gone for more
  than 15 s a bot covers for you until you return. Coming back from another tab, browser or
  device? Join the room with the same name and you take your seat back (as long as your old
  connection is gone). Leaving the room hands your cards to a bot
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

### Music

The songs play in YouTube's own player in each browser; the server only keeps the room's
queue and where the song is, and each player keeps in step with it (within about 2 s).

- Some videos don't allow playing on other sites (many official music videos do, some
  don't). Those are taken off the queue with a note to whoever added them.
- If the browser blocks sound until you've clicked something, the card shows
  **Tap to listen**.
- YouTube needs the player on show, so it stays visible (small) while music plays. Each song
  title is looked up from YouTube by the server, which needs internet access.

### Safety on a public server

- The server runs the game and checks every move; browsers never receive other players'
  hidden cards.
- There are no accounts and nothing is stored: names, chat and rooms live in memory only.
  Anyone with a room's code can join it, so share codes only with friends; the host can
  remove anyone. The same goes for a seat whose player has lost their connection: anyone
  who joins under that name takes it over.
- Names and chat are cleaned and shown as plain text. Chat is rate-limited, messages are
  capped in size, and each address is limited in open connections (16), messages and how
  many rooms it can create or try to join per minute (30), which stops room-code guessing.
- Voice chat connects browsers directly, so the players you talk to can see your IP address.
  Only players who have joined voice in the same room are connected.
- An unexpected error is logged instead of taking down every room.

## How to play

### Monopoly Deal

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

While it's your turn a gold frame runs round the screen. Your turn starts with a chime and a
buzz on phones that support it, and the tab title changes if the game is in the background.

Each table shows its owner's property sets; banked money appears only as their total next
to their name (hover it to see the bills).

On a phone held upright every table stays in view, one per row: each player's name, money,
sets and hand size sit in a bar down the left of their cards, and the deck and discard pile
shrink to two counts in the top bar, where cards are drawn from and discarded to.

### Call Bridge

Bid how many tricks you'll take, then take at least that many, but not twice as many.

- A game has one round per player, and everyone is the **den** once. Each round the whole
  deck is dealt out evenly: 26, 17, 13, 10, 8, 7 or 6 cards each for 2–8 players. Any cards left over
  are set aside unseen.
- The den sees only the first half of their cards, then calls **trumps**. The rest of the
  cards are dealt after that. If anyone ends up with no trumps, the cards are shuffled and
  dealt again, and the den calls trumps again.
- Starting with the den and going clockwise, everyone **bids** how many tricks they'll take:
  at least 2, at most the number of cards in hand.
- The den leads the first trick, and whoever wins a trick leads the next. Follow the suit
  that was led if you can; if not, play anything. The highest trump wins the trick; with no
  trumps in it, the highest card of the suit led wins. Aces are high.
- **Scoring** (extra tricks are the ones over your bid):
  - Fewer tricks than you bid: **−10 × bid**.
  - Your bid, with fewer extra tricks than you bid: **10 × bid + extras**. Bid 3 and
    take 5: +32.
  - As many extra tricks as you bid, or more: **−(10 × bid + extras)**. Bid 3 and
    take 6: −33.
- The highest total after the last round wins, and a tie is a shared win.

Click a card to play it (on a phone, tap to lift it and tap again to play). Cards you can't
play are dimmed. The trump call and the bid sit in a panel above your hand, so the table
stays in view, and the bid panel shows what your bid would score. Each player's bar shows
their total and the tricks they've won out of their bid. The round counter in the top bar
(with the trump suit) opens the scores so far.

**Cards** on the start screen switches between the **Classic** deck and a **Fantasy** one,
with Moons ☾, Suns ☀, Clovers ☘ and Stars ★ in place of spades, hearts, clubs and diamonds
and the Elf (E), Wizard (W), Dragon (D) and Phoenix (P) in place of the jack, queen, king
and ace. Only the look changes, not the game. Judgement has the same choice and the same
Fantasy deck. A Call Bridge or Judgement game with the Fantasy deck starts
with a short guide to the new cards and their order (tick *Don't show this again* to skip
it; it stays in **How to play**). The choice is saved in
your browser, so online everyone plays with the deck they picked.

### Judgement

Bid how many tricks you'll take, and take **exactly** that many. The rules are
[kard.games'](https://kard.games/src/web/help.html) (the game is also called Kachuful or
Oh Hell), for 2–5 players against the computer and up to 8 online.

- The first round deals **7 cards** each (**6** with 8 players). Each round deals one fewer,
  down to **1**, then one more each round back up again: 13 rounds (11 with 8 players). The rest of the deck is set aside unseen.
- Trumps go round in turn: **spades, diamonds, clubs, hearts**, then a round with
  **no trumps**, and again from spades.
- The deal moves round the table. From the dealer's left, everyone **bids** 0 up to the
  cards in hand. The dealer bids last and **can't** make the bids add up to the number of
  tricks, so someone always misses (that bid is greyed out).
- The player on the dealer's left leads the first trick; whoever wins a trick leads the
  next. Follow the suit led if you can. The highest trump wins, otherwise the highest card
  of the suit led. Aces are high.
- **Scoring**: only an exact bid scores. Pick one on the start screen, or the host picks in
  the lobby:
  - **High** (the usual): made, **(bid + 1) × 10 + bid**; missed, the same taken off. Bid 3
    and take 3: +43; take 2 or 4: −43. Bid 0 and take none: +10.
  - **Medium**: made, **10 × bid**; missed, 0.
  - **Low**: made, **bid × 2 + 5**; missed, 0.
- The highest total after the last round wins, and a tie is a shared win.

It plays on the same table as Call Bridge: the dealer has a **Dealer** tag, and the round
counter in the top bar shows the trumps (**NT** for none) and opens the scores.

### Bingo

The pen-and-paper version: no caller, no tickets, everyone calls in turn.

- Everyone gets a 5×5 grid with the numbers 1–25 in a random order, and arranges it at the
  same time: tap two squares to swap them, or **Shuffle**, then **Ready**. Nobody else sees
  your grid.
- Then, in turn, each player **calls** a number that hasn't been called yet. Every player
  crosses it off their own grid (the app does this for you).
- Each full row, column or diagonal crossed off is a line, and lights the next letter of
  **B-I-N-G-O**. The first to five lines wins. If two or more get there on the same call,
  they share the win.

Tap a number on your grid to call it (on a phone, tap to pick it and tap again to call it).
The number just called shows in the middle in its caller's colour, with the earlier calls
beside it. Each player's bar shows the letters they've lit, and at the end everyone's grid
is shown.

### Wordle

A race: everyone guesses the same word at the same time.

- A game is 5, 10 or 20 words (pick on the start screen, or in the lobby online).
- Each word is a secret five-letter word, and everyone gets six guesses. Every guess has to
  be a real word. Each letter is marked **green** (right letter, right place), **yellow** (in
  the word, somewhere else) or grey (not in it, or not as many times as you used it).
- The first to get the word scores a point, and the word ends for everyone. If nobody gets
  it in six guesses each, or within 3 minutes, nobody scores.
- The most points after the last word wins; a tie is a shared win.
- To play on your own, pick **None** for opponents: no bots and no clock, so each word lasts
  until you get it or use up your six guesses. The end shows how many words you got.

Type on your keyboard or the one on screen, and press **Enter**. Each opponent's bar shows
their guesses as coloured squares, without the letters until the word is over. The clock in
your bar counts down the time left, and the word counter in the top bar opens the scores.
Bots take about 50 s to get a word, about a person's pace. The secret
words are about 950 common words picked by hand; any of 12,500 words is accepted as a guess
(from the MIT-licensed [word-list](https://github.com/sindresorhus/word-list) package; see
`scripts/build-wordle-guesses.mjs`).

### Pool

Eight-ball, one on one or two against two (partners take turns and share a group). Against
the computer, pick **1 vs 1** or **2 vs 2** (you and a bot partner); online, two play, or
four as two teams, and anyone else in the room watches.

- The cue ball starts behind the line for the **break**. After the break the table is
  **open**: the first player to pot a ball legally takes that group, **solids** (1–7) or
  **stripes** (9–15), and the other side gets the other.
- Pot one of your own balls and you shoot again; otherwise it's the other side's turn.
- **Fouls**: potting the cue ball (a scratch), hitting nothing, hitting the wrong ball first
  (on an open table, the 8 first), or no ball reaching a cushion after the hit with nothing
  potted. After a foul the other side has **ball in hand**: they put the cue ball anywhere.
- Clear your group, then sink the **8** to win. Sink it early, or with a foul, and you lose.
  An 8 potted on the break is put back on the spot.
- House rules where tournaments differ: no called pockets, and ball in hand anywhere after
  any foul.

It's laid out like the pool apps. A card for each side across the top shows its players and
the seven balls of its group, greyed out as they drop, then the 8; online, a ring round the
shooter's avatar runs down their 60 seconds. To aim, drag on the table to swing the cue round
the cue ball, or tap a ball to aim straight at it. The guide shows the cue ball's path to a
ghost ball, then which way the object ball and the cue ball go (red with a cross if that ball
isn't yours to hit first). Fine-tune with the wheel on the right (or ← →). To shoot, pull the
cue on the left down as far as the power you want and let go (or ↑ ↓ and Space). With ball in
hand there's a ✋ on the cue ball: drag it where you want. The table is lengthways on wide
screens and upright on phones, the break end nearest you.

The physics (src/pool/physics.js) uses only arithmetic and square roots, which come out the
same in every browser: online, the server plays each shot and every browser replays it from
the same positions, so everyone sees the same thing.

## Code layout

```
src/
  game/      Monopoly Deal's pure rules — no rendering
    cards.js     the 106-card deck
    rules.js     set sizes, rent, payments, validation
    engine.js    async turn loop; asks controllers for every decision
    ai.js        computer opponents
    settings.js  the games, the game speed and online time limits
  callbridge/ Call Bridge's rules, engine and AI, the same way
    cards.js     the 52-card deck (Judgement's too)
    rules.js     dealing, bids, following suit, trick winners, scoring
    engine.js    rounds and tricks; asks controllers for trumps, bids and cards
    ai.js        computer opponents
  judgement/ Judgement's rules, engine and AI. It shares Call Bridge's deck, and the
             trick-taking table, mirror and prompts
    rules.js     hand sizes, trumps by round, the dealer's ruled-out bid, the three scorings
    engine.js    rounds and tricks; asks controllers for bids and cards
    ai.js        computer opponents (bid from simulated deals, play like Call Bridge's)
  bingo/     Bingo's rules, engine and AI
    rules.js     grids, lines, B-I-N-G-O letters
    engine.js    arranging, then calls in turn; asks controllers for grids and numbers
    ai.js        computer opponents (call the number that helps their own lines most)
  pool/      Pool's physics, rules, engine and AI
    physics.js   balls rolling, colliding, bouncing off cushions and dropping (deterministic)
    rules.js     the rack, groups, fouls and what each shot means
    engine.js    turns and teams; asks controllers for shots (and with ball in hand, a place)
    ai.js        computer opponents (ghost-ball aiming, then the best few played out)
  wordle/    Wordle's rules, engine and AI
    answers.js   the secret words, picked by hand
    guesses.js   every other word accepted as a guess (generated)
    rules.js     marking a guess, the keyboard's colours, game lengths
    engine.js    each word a race: asks everyone for guesses at once
    ai.js        computer opponents (guess a word that fits, at a person's pace)
  render/    the tables (DOM + CSS)
    view.js      player panels, card layout and animation
    trick-view.js      the Call Bridge and Judgement table, built on view.js
    bingo-view.js      the Bingo table: player bars, the calls and your grid
    wordle-view.js     the Wordle table: player bars, your guesses and the keyboard
    pool-view.js       the pool table on a canvas: shots replayed, aiming and power
    textures.js  card faces (both decks) drawn on canvas
    deck-style.js  Call Bridge’s and Judgement’s card style (classic or fantasy suits)
  ui/
    hud.js       menus, modals, toasts, log
    human.js     turns HUD input into engine actions
    tricks.js    Call Bridge's and Judgement's prompts, status line and score tables
    bingo.js     Bingo's grid arranging and calling, status line and result
    wordle.js    Wordle's guesses, status line, scores and result
    pool.js      Pool's shots, status line and result
    lobby.js     online room lobby
    chat.js      room chat panel
  net/       online client
    connection.js  WebSocket with automatic reconnect
    online.js      one online session: lobby, game, prompts, chat, voice, music
    mirror.js      read-only copy of the server's game for the view and HUD
    trick-mirror.js      the same for a Call Bridge or Judgement game
    bingo-mirror.js      and for a Bingo game
    wordle-mirror.js     and for a Wordle game
    pool-mirror.js       and for a Pool game
    voice.js       voice chat: microphone, browser-to-browser calls, who's talking
    music.js       the room's music: the YouTube player kept in step with the room
    youtube.js     YouTube links to video ids (shared with the server)
  main.js    wires it all together
server/
  index.js     production server (static files + rooms)
  hub.js       /ws endpoint, room codes, message routing
  room.js      lobby, seats, bots, timeouts, reconnects; runs the real engine
  viewer.js    per-player snapshots that hide other players' cards
scripts/
  simulate.mjs     headless AI games
  simulate-callbridge.mjs  the same for Call Bridge
  simulate-judgement.mjs   and for Judgement
  simulate-bingo.mjs      and for Bingo
  simulate-wordle.mjs     and for Wordle
  simulate-pool.mjs       and for Pool
  build-wordle-guesses.mjs  regenerates src/wordle/guesses.js from the word-list package
  online-smoke.mjs headless multiplayer games over real sockets
```

The engine talks to players only through a controller interface (`chooseTurnAction`,
`choosePayment`, `chooseJustSayNo`, `chooseDiscards`), so humans and the AI are
interchangeable, and the engine runs headless without a view. Call Bridge's engine works the
same way, with `chooseTrump`, `chooseBid` and `choosePlay` (Judgement's only asks
`chooseBid` and `choosePlay`), and so does Bingo's, with
`arrangeGrid` (asked of everyone at once) and `chooseCall`. Wordle's asks everyone for
`chooseGuess` at once, again after each guess, and calls `stopGuess` when the word is over. Pool's asks `chooseShot`: a direction, a power, and
with ball in hand where the cue ball goes.

Online, the server runs that same engine. A human seat's controller forwards each decision
to that player's browser as a `request` and waits for the `response`, falling back to the AI
on timeout or disconnect. After every change the server sends each player a snapshot of the
table in which other players' hidden cards carry no details and fresh ids, so the browser
can't peek. The client applies snapshots to a mirror game that the existing table view and
HUD read from, and answers requests with the same `HumanController` (or `TrickHuman`, `BingoHuman`, `WordleHuman`, `PoolHuman`)
used for solo play.
