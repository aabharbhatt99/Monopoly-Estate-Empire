# Estate Empire

An international property board game for **4–10 players** that runs on your laptop. The board has 40 spaces: 26 famous cities in 10 countries (Egypt, Brazil, Australia, Spain, India, Italy, France, the United Kingdom, Japan and the United States), 4 airports, 2 utilities, one Fortune and one Community Fund space, a **Random** corner, and the **Auction House**, the only place where trading happens. You also get jail, auctions, houses and hotels, mortgages and bankruptcy. Play starts in the bottom-left corner and runs clockwise. The host can rename every space (and change the currency symbol) in the lobby.

You can play two ways:
- **Pass & Play:** everyone shares one laptop.
- **Online:** private rooms joined with a 5-letter code from other laptops.

Games save automatically and can be resumed.

---

## Running it

You need **Node.js 18 or newer** (tested on Node 20). Open a terminal in this folder.

```bash
npm install        # first time only
npm start          # builds the game and starts the server
```

Open **http://localhost:3001** in your browser.

### Playing online with other laptops (same Wi-Fi / network)

1. Run `npm start` on the host laptop. The console prints addresses such as `http://192.168.1.14:3001`.
2. On the host, choose **Host Online → Create private room**, and add your own seat.
3. Other players open that address in their browser, choose **Join a Room** and enter the room code. Each of them then takes a seat (name, token and colour).
4. Once 4–10 seats are filled, the host clicks **Start the game**.

If Windows Firewall asks whether to allow Node.js on private networks, click **Allow**.

> Playing across different networks (over the internet) needs port forwarding or a tunnel (e.g. a VPN such as Tailscale). That isn't built in.

### Hosting on Cloudflare (online play over the internet)

The game is a Cloudflare Worker: `dist/` is served as static assets, and `/ws` connects to a Durable Object (`worker/index.js`) that stores the shared room documents. The host's browser still runs the game, so the host should keep their page open.

```bash
npm run build && npx wrangler deploy     # deploy
npm run build && npx wrangler dev        # run locally on http://localhost:8787
```

### Development mode (hot reload)

```bash
npm run dev        # server on :3001 + Vite dev server on :5173
```

Open **http://localhost:5173**.

### Tests

```bash
npm test           # 66 rule tests + 10 random full games (~2 min)
npm run test:fuzz  # 40 random full games (slower, deeper)
npm run typecheck  # TypeScript check across engine, server, client and tests
npm run serve      # (in another terminal) start the server, then:
npm run smoke      # end-to-end test through the real server over Socket.IO
```

---

## How to play

- **Computer players:** in the lobby (Pass & Play or Online) the host can click **🤖 Add computer** to fill seats. The host's browser plays their moves (rolling, buying, bidding, building, raising cash, answering trade offers), so keep the host page open.
- **Setup:** add 4–10 players, each with a unique name and token and a colour. The host sets the starting cash, START salary, game mode, auction timer, currency symbol and space names. The first player is drawn at random.
- **Your turn:** click **Roll dice**. Your token walks around the board. Unowned property: **Buy** it, or **Auction it**; every player may then bid, including you. Rolling doubles gives you another roll. Three doubles in a row sends you to jail.
- **Anytime:** click a player on the left to open their dashboard. From there you can build or sell houses and hotels, mortgage or unmortgage, see their transaction history, and propose trades. Hover any board space to see its details (rent, owner, buildings, who owns the rest of the set); click it for the full title deed. Hover a player in the list to light up everything they own.
- **Trades:** you can only trade on your own turn, after landing on the **Auction House** (top-right corner). Trading stays open until you move off it or end your turn. Any offers still open then are withdrawn. Other players can accept, reject or counter your offers, but they can't start trades of their own. Trades can include properties, cash and Get Out of Jail Free cards. The recipient can **Accept**, **Reject** or send a **Counteroffer**. Each offer shows both players' cash before and after the trade.
- **Random corner:** landing here draws a card from the Fortune or the Community Fund deck, picked at random. (There is no Go To Jail space. You go to jail from a card or from three doubles in a row.)
- **Jail:** pay the $50 fine, use a card, or roll for doubles, for up to 3 turns. If the 3rd attempt fails, you pay the fine and move. While in jail you can still collect rent, trade, build and mortgage.
- **Debt:** if you can't afford a payment, nothing goes negative. Instead a pending debt appears. Sell buildings, mortgage, or trade to raise the money. The debt is paid automatically as soon as you have enough. If you can't raise it, declare bankruptcy.
- **Host controls:** Pause/Resume, End game (highest net worth wins), Restart (same players), and the music and sound toggles.

### Game modes

- **Classic:** play until only one solvent player remains.
- **Timed:** the game ends when the clock runs out, and the highest **net worth** wins.

### Net worth scoring rule

> **Net worth = cash + printed price of each property you own (mortgage value instead, if mortgaged) + the purchase cost of every building (a hotel = 5 × the house cost) − any unpaid debts.**

Ties are broken by cash. The same formula is shown on every dashboard and used when the host ends a game early.

---

## Rules implemented (and the precise choices made)

| Area | Behaviour |
|---|---|
| START | Salary paid for passing or landing, including card moves forward. Not paid for "go back 3 spaces" or being sent to jail. |
| Rent | Base rent, doubled for an unimproved complete country set. House/hotel rent from the deed. Airports: $25/50/100/200 by number owned. Utilities: 4× dice, or 10× with both. No rent on mortgaged properties. An owner in jail still collects rent. |
| Cards | 16 Fortune and 16 Community Fund cards, shuffled, with original wording. You draw from Fortune (space 22), Community Fund (space 2) or the Random corner (space 30, either deck at 50/50). "Nearest airport" charges double rent. "Nearest utility" makes you roll again and pay 10× that roll. Get Out of Jail Free cards are held, tradeable, and go back to the bottom of their deck when used. |
| Building | You need the full colour set with no mortgages in it. Building must be even (and so must selling). Max 4 houses, then a hotel, which returns 4 houses to the bank. The bank has 32 houses and 12 hotels (housing shortage enforced). Buildings sell back at half price. If the bank lacks 4 houses to break a hotel down, use **Sell all buildings in group**. |
| Mortgages | You receive half the price. Unmortgaging costs that amount + 10% (rounded up). You can't mortgage while the colour group has buildings. |
| Trading | Only while the current player is on the Auction House after landing there this turn, and never during an auction. Only that player can start a trade. Others can only counter. Open offers are withdrawn when the player moves off the Auction House or the turn ends. Properties whose group has buildings can't be traded. Whoever receives a mortgaged property pays 10% interest immediately. Offers are re-validated when accepted, and stale offers are marked invalid. |
| Auctions | Open bidding. Every solvent player, including the one who declined, can bid or pass. The timer (default 15 s, configurable, 0 = off) resets on every bid. You can't bid more than the cash you have. If nobody bids, the bank keeps the property. |
| Bankruptcy | **To a player:** buildings are sold to the bank at half price, then all cash, properties (mortgages stay, with 10% interest charged to the receiver) and jail cards go to the creditor. **To the bank:** properties return unmortgaged and are auctioned one after another. Bankrupt players are skipped in the turn order, and their transaction history is kept. |
| Turns | A doubles roll gives another roll. The 3rd double sends you to jail without moving. Going to jail always ends your turn. You can't end your turn while a purchase decision, an auction or a debt is unresolved. |

### Known limitations and judgment calls

- **Multiple creditors:** if a player owes several players at once (e.g. "pay every player $50") and goes bankrupt, all assets go to the creditor first in the queue. The remaining small debts to other players are cancelled.
- **Timed mode** ends the moment the clock hits zero, even mid-turn.
- **Online security:** there are no accounts. Anyone with the room code can join, and can claim a seat whose player is currently offline (that's how reconnecting from a different device works). This is fine for friends on a home network. Don't expose the server to the public internet.
- **Fonts** load from Google Fonts. Offline, the game falls back to system fonts and still plays.
- Card texts name specific cities (for example "Advance to Rome"). They don't change if the host renames those spaces.

---

## Project structure

```
src/engine/       Pure TypeScript rules engine (no UI, no I/O)
  types.ts        Game state, actions, config types
  board.ts        The 40 spaces, prices, rent tables, groups
  cards.ts        Both card decks (original wording)
  engine.ts       createGame(), applyAction() reducer, rent/net-worth/validators
  room.ts         Lobby/room types shared by client and server
server/
  index.ts        Express + Socket.IO; authoritative game server, timers, permissions
  db.ts           SQLite persistence (data/estate-empire.db), autosave on every action
src/client/       React + Tailwind UI
  screens/        Home, Lobby, Game, History
  components/     Board, Dice, Property, Players, Trade, Panels (auction/debt/cards/log/game over)
  sound.ts        Synthesised sound effects + optional background music (WebAudio)
tests/            Vitest: rule tests + randomized full-game invariant fuzzing
scripts/smoke.ts  End-to-end test through the running server
```

**How it fits together:** the server holds the official game state for every room. Every move is sent to the server as an action. The engine checks it (whose turn it is, which phase, the rules, and whether that device controls that player), applies it, saves to SQLite, and sends the new state to every connected browser. A Pass & Play game is a room where one device controls all the seats, so local and online games use the same code path. The engine is a pure function with its own seeded dice, so the tests can replay exact situations.
